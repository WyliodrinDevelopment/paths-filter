"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const filter_1 = require("./filter");
const file_1 = require("./file");
const git = __importStar(require("./git"));
const shell_escape_1 = require("./list-format/shell-escape");
const csv_escape_1 = require("./list-format/csv-escape");
async function run() {
    try {
        const workingDirectory = core.getInput('working-directory', { required: false });
        if (workingDirectory) {
            process.chdir(workingDirectory);
        }
        const token = core.getInput('token', { required: false });
        const ref = core.getInput('ref', { required: false });
        const base = core.getInput('base', { required: false });
        const filtersInput = core.getInput('filters', { required: true });
        const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput;
        const listFiles = core.getInput('list-files', { required: false }).toLowerCase() || 'none';
        const initialFetchDepth = parseInt(core.getInput('initial-fetch-depth', { required: false })) || 10;
        if (!isExportFormat(listFiles)) {
            core.setFailed(`Input parameter 'list-files' is set to invalid value '${listFiles}'`);
            return;
        }
        const filter = new filter_1.Filter(filtersYaml);
        const files = await getChangedFiles(token, base, ref, initialFetchDepth);
        core.info(`Detected ${files.length} changed files`);
        const results = filter.match(files);
        exportResults(results, listFiles);
    }
    catch (error) {
        // core.setFailed(error.message)
        core.setOutput('changes', {
            changesFound: true
        });
    }
}
function isPathInput(text) {
    return !(text.includes('\n') || text.includes(':'));
}
function getConfigFileContent(configPath) {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file '${configPath}' not found`);
    }
    if (!fs.lstatSync(configPath).isFile()) {
        throw new Error(`'${configPath}' is not a file.`);
    }
    return fs.readFileSync(configPath, { encoding: 'utf8' });
}
async function getChangedFiles(token, base, ref, initialFetchDepth) {
    // if base is 'HEAD' only local uncommitted changes will be detected
    // This is the simplest case as we don't need to fetch more commits or evaluate current/before refs
    if (base === git.HEAD) {
        if (ref) {
            core.warning(`'ref' input parameter is ignored when 'base' is set to HEAD`);
        }
        return await git.getChangesOnHead();
    }
    const prEvents = ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_target'];
    if (prEvents.includes(github.context.eventName)) {
        if (ref) {
            core.warning(`'ref' input parameter is ignored when 'base' is set to HEAD`);
        }
        if (base) {
            core.warning(`'base' input parameter is ignored when action is triggered by pull request event`);
        }
        const pr = github.context.payload.pull_request;
        if (token) {
            return await getChangedFilesFromApi(token, pr);
        }
        if (github.context.eventName === 'pull_request_target') {
            // pull_request_target is executed in context of base branch and GITHUB_SHA points to last commit in base branch
            // Therefor it's not possible to look at changes in last commit
            // At the same time we don't want to fetch any code from forked repository
            throw new Error(`'token' input parameter is required if action is triggered by 'pull_request_target' event`);
        }
        core.info('Github token is not available - changes will be detected from PRs merge commit');
        return await git.getChangesInLastCommit();
    }
    else {
        return getChangedFilesFromGit(base, ref, initialFetchDepth);
    }
}
async function getChangedFilesFromGit(base, head, initialFetchDepth) {
    var _a;
    const defaultBranch = (_a = github.context.payload.repository) === null || _a === void 0 ? void 0 : _a.default_branch;
    const beforeSha = github.context.eventName === 'push' ? github.context.payload.before : null;
    const currentRef = await git.getCurrentRef();
    head = git.getShortName(head || github.context.ref || currentRef);
    base = git.getShortName(base || defaultBranch);
    if (!head) {
        throw new Error("This action requires 'head' input to be configured, 'ref' to be set in the event payload or branch/tag checked out in current git repository");
    }
    if (!base) {
        throw new Error("This action requires 'base' input to be configured or 'repository.default_branch' to be set in the event payload");
    }
    const isBaseSha = git.isGitSha(base);
    const isBaseSameAsHead = base === head;
    // If base is commit SHA we will do comparison against the referenced commit
    // Or if base references same branch it was pushed to, we will do comparison against the previously pushed commit
    if (isBaseSha || isBaseSameAsHead) {
        const baseSha = isBaseSha ? base : beforeSha;
        if (!baseSha) {
            core.warning(`'before' field is missing in event payload - changes will be detected from last commit`);
            if (head !== currentRef) {
                core.warning(`Ref ${head} is not checked out - results might be incorrect!`);
            }
            return await git.getChangesInLastCommit();
        }
        // If there is no previously pushed commit,
        // we will do comparison against the default branch or return all as added
        if (baseSha === git.NULL_SHA) {
            if (defaultBranch && base !== defaultBranch) {
                core.info(`First push of a branch detected - changes will be detected against the default branch ${defaultBranch}`);
                return await git.getChangesSinceMergeBase(defaultBranch, head, initialFetchDepth);
            }
            else {
                core.info('Initial push detected - all files will be listed as added');
                if (head !== currentRef) {
                    core.warning(`Ref ${head} is not checked out - results might be incorrect!`);
                }
                return await git.listAllFilesAsAdded();
            }
        }
        core.info(`Changes will be detected between ${baseSha} and ${head}`);
        return await git.getChanges(baseSha, head);
    }
    core.info(`Changes will be detected between ${base} and ${head}`);
    return await git.getChangesSinceMergeBase(base, head, initialFetchDepth);
}
// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(token, prNumber) {
    core.startGroup(`Fetching list of changed files for PR#${prNumber.number} from Github API`);
    try {
        const client = new github.GitHub(token);
        const per_page = 100;
        const files = [];
        core.info(`Invoking listFiles(pull_number: ${prNumber.number}, per_page: ${per_page})`);
        for await (const response of client.paginate.iterator(client.pulls.listFiles.endpoint.merge({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber.number,
            per_page
        }))) {
            if (response.status !== 200) {
                throw new Error(`Fetching list of changed files from GitHub API failed with error code ${response.status}`);
            }
            core.info(`Received ${response.data.length} items`);
            for (const row of response.data) {
                core.info(`[${row.status}] ${row.filename}`);
                // There's no obvious use-case for detection of renames
                // Therefore we treat it as if rename detection in git diff was turned off.
                // Rename is replaced by delete of original filename and add of new filename
                if (row.status === file_1.ChangeStatus.Renamed) {
                    files.push({
                        filename: row.filename,
                        status: file_1.ChangeStatus.Added
                    });
                    files.push({
                        // 'previous_filename' for some unknown reason isn't in the type definition or documentation
                        filename: row.previous_filename,
                        status: file_1.ChangeStatus.Deleted
                    });
                }
                else {
                    // Github status and git status variants are same except for deleted files
                    const status = row.status === 'removed' ? file_1.ChangeStatus.Deleted : row.status;
                    files.push({
                        filename: row.filename,
                        status
                    });
                }
            }
        }
        return files;
    }
    finally {
        core.endGroup();
    }
}
function exportResults(results, format) {
    core.info('Results:');
    const changes = [];
    for (const [key, files] of Object.entries(results)) {
        const value = files.length > 0;
        core.startGroup(`Filter ${key} = ${value}`);
        if (files.length > 0) {
            changes.push(key);
            core.info('Matching files:');
            for (const file of files) {
                core.info(`${file.filename} [${file.status}]`);
            }
        }
        else {
            core.info('Matching files: none');
        }
        core.setOutput(key, value);
        core.setOutput(`${key}_count`, files.length);
        if (format !== 'none') {
            const filesValue = serializeExport(files, format);
            core.setOutput(`${key}_files`, filesValue);
        }
        core.endGroup();
    }
    if (results['changes'] === undefined) {
        const changesJson = JSON.stringify(changes);
        core.info(`Changes output set to ${changesJson}`);
        core.setOutput('changes', changesJson);
    }
    else {
        core.info('Cannot set changes output variable - name already used by filter output');
    }
}
function serializeExport(files, format) {
    const fileNames = files.map(file => file.filename);
    switch (format) {
        case 'csv':
            return fileNames.map(csv_escape_1.csvEscape).join(',');
        case 'json':
            return JSON.stringify(fileNames);
        case 'escape':
            return fileNames.map(shell_escape_1.backslashEscape).join(' ');
        case 'shell':
            return fileNames.map(shell_escape_1.shellEscape).join(' ');
        default:
            return '';
    }
}
function isExportFormat(value) {
    return ['none', 'csv', 'shell', 'json', 'escape'].includes(value);
}
run();