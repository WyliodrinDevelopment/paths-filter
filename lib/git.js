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
exports.isGitSha = exports.getShortName = exports.getCurrentRef = exports.listAllFilesAsAdded = exports.parseGitDiffOutput = exports.getChangesSinceMergeBase = exports.getChangesOnHead = exports.getChanges = exports.getChangesInLastCommit = exports.HEAD = exports.NULL_SHA = void 0;
const exec_1 = require("@actions/exec");
const core = __importStar(require("@actions/core"));
const file_1 = require("./file");
exports.NULL_SHA = '0000000000000000000000000000000000000000';
exports.HEAD = 'HEAD';
async function getChangesInLastCommit() {
    core.startGroup(`Change detection in last commit`);
    let output = '';
    try {
        output = (await exec_1.getExecOutput('git', ['log', '--format=', '--no-renames', '--name-status', '-z', '-n', '1'])).stdout;
    }
    finally {
        fixStdOutNullTermination();
        core.endGroup();
    }
    return parseGitDiffOutput(output);
}
exports.getChangesInLastCommit = getChangesInLastCommit;
async function getChanges(base, head) {
    const baseRef = await ensureRefAvailable(base);
    const headRef = await ensureRefAvailable(head);
    // Get differences between ref and HEAD
    core.startGroup(`Change detection ${base}..${head}`);
    let output = '';
    try {
        // Two dots '..' change detection - directly compares two versions
        output = (await exec_1.getExecOutput('git', ['diff', '--no-renames', '--name-status', '-z', `${baseRef}..${headRef}`]))
            .stdout;
    }
    finally {
        fixStdOutNullTermination();
        core.endGroup();
    }
    return parseGitDiffOutput(output);
}
exports.getChanges = getChanges;
async function getChangesOnHead() {
    // Get current changes - both staged and unstaged
    core.startGroup(`Change detection on HEAD`);
    let output = '';
    try {
        output = (await exec_1.getExecOutput('git', ['diff', '--no-renames', '--name-status', '-z', 'HEAD'])).stdout;
    }
    finally {
        fixStdOutNullTermination();
        core.endGroup();
    }
    return parseGitDiffOutput(output);
}
exports.getChangesOnHead = getChangesOnHead;
async function getChangesSinceMergeBase(base, head, initialFetchDepth) {
    let baseRef;
    let headRef;
    async function hasMergeBase() {
        if (baseRef === undefined || headRef === undefined) {
            return false;
        }
        return (await exec_1.getExecOutput('git', ['merge-base', baseRef, headRef], { ignoreReturnCode: true })).exitCode === 0;
    }
    let noMergeBase = false;
    core.startGroup(`Searching for merge-base ${base}...${head}`);
    try {
        baseRef = await getLocalRef(base);
        headRef = await getLocalRef(head);
        if (!(await hasMergeBase())) {
            await exec_1.getExecOutput('git', ['fetch', '--no-tags', `--depth=${initialFetchDepth}`, 'origin', base, head]);
            if (baseRef === undefined || headRef === undefined) {
                baseRef = baseRef !== null && baseRef !== void 0 ? baseRef : (await getLocalRef(base));
                headRef = headRef !== null && headRef !== void 0 ? headRef : (await getLocalRef(head));
                if (baseRef === undefined || headRef === undefined) {
                    await exec_1.getExecOutput('git', ['fetch', '--tags', '--depth=1', 'origin', base, head], {
                        ignoreReturnCode: true // returns exit code 1 if tags on remote were updated - we can safely ignore it
                    });
                    baseRef = baseRef !== null && baseRef !== void 0 ? baseRef : (await getLocalRef(base));
                    headRef = headRef !== null && headRef !== void 0 ? headRef : (await getLocalRef(head));
                    if (baseRef === undefined) {
                        throw new Error(`Could not determine what is ${base} - fetch works but it's not a branch, tag or commit SHA`);
                    }
                    if (headRef === undefined) {
                        throw new Error(`Could not determine what is ${head} - fetch works but it's not a branch, tag or commit SHA`);
                    }
                }
            }
            let depth = initialFetchDepth;
            let lastCommitCount = await getCommitCount();
            while (!(await hasMergeBase())) {
                depth = Math.min(depth * 2, Number.MAX_SAFE_INTEGER);
                await exec_1.getExecOutput('git', ['fetch', `--deepen=${depth}`, 'origin', base, head]);
                const commitCount = await getCommitCount();
                if (commitCount === lastCommitCount) {
                    core.info('No more commits were fetched');
                    core.info('Last attempt will be to fetch full history');
                    await exec_1.getExecOutput('git', ['fetch']);
                    if (!(await hasMergeBase())) {
                        noMergeBase = true;
                    }
                    break;
                }
                lastCommitCount = commitCount;
            }
        }
    }
    finally {
        core.endGroup();
    }
    // Three dots '...' change detection - finds merge-base and compares against it
    let diffArg = `${baseRef}...${headRef}`;
    if (noMergeBase) {
        core.warning('No merge base found - change detection will use direct <commit>..<commit> comparison');
        diffArg = `${baseRef}..${headRef}`;
    }
    // Get changes introduced on ref compared to base
    core.startGroup(`Change detection ${diffArg}`);
    let output = '';
    try {
        output = (await exec_1.getExecOutput('git', ['diff', '--no-renames', '--name-status', '-z', diffArg])).stdout;
    }
    finally {
        fixStdOutNullTermination();
        core.endGroup();
    }
    return parseGitDiffOutput(output);
}
exports.getChangesSinceMergeBase = getChangesSinceMergeBase;
function parseGitDiffOutput(output) {
    const tokens = output.split('\u0000').filter(s => s.length > 0);
    const files = [];
    for (let i = 0; i + 1 < tokens.length; i += 2) {
        files.push({
            status: statusMap[tokens[i]],
            filename: tokens[i + 1]
        });
    }
    return files;
}
exports.parseGitDiffOutput = parseGitDiffOutput;
async function listAllFilesAsAdded() {
    core.startGroup('Listing all files tracked by git');
    let output = '';
    try {
        output = (await exec_1.getExecOutput('git', ['ls-files', '-z'])).stdout;
    }
    finally {
        fixStdOutNullTermination();
        core.endGroup();
    }
    return output
        .split('\u0000')
        .filter(s => s.length > 0)
        .map(path => ({
        status: file_1.ChangeStatus.Added,
        filename: path
    }));
}
exports.listAllFilesAsAdded = listAllFilesAsAdded;
async function getCurrentRef() {
    core.startGroup(`Get current git ref`);
    try {
        const branch = (await exec_1.getExecOutput('git', ['branch', '--show-current'])).stdout.trim();
        if (branch) {
            return branch;
        }
        const describe = await exec_1.getExecOutput('git', ['describe', '--tags', '--exact-match'], { ignoreReturnCode: true });
        if (describe.exitCode === 0) {
            return describe.stdout.trim();
        }
        return (await exec_1.getExecOutput('git', ['rev-parse', exports.HEAD])).stdout.trim();
    }
    finally {
        core.endGroup();
    }
}
exports.getCurrentRef = getCurrentRef;
function getShortName(ref) {
    if (!ref)
        return '';
    const heads = 'refs/heads/';
    const tags = 'refs/tags/';
    if (ref.startsWith(heads))
        return ref.slice(heads.length);
    if (ref.startsWith(tags))
        return ref.slice(tags.length);
    return ref;
}
exports.getShortName = getShortName;
function isGitSha(ref) {
    return /^[a-z0-9]{40}$/.test(ref);
}
exports.isGitSha = isGitSha;
async function hasCommit(ref) {
    return (await exec_1.getExecOutput('git', ['cat-file', '-e', `${ref}^{commit}`], { ignoreReturnCode: true })).exitCode === 0;
}
async function getCommitCount() {
    const output = (await exec_1.getExecOutput('git', ['rev-list', '--count', '--all'])).stdout;
    const count = parseInt(output);
    return isNaN(count) ? 0 : count;
}
async function getLocalRef(shortName) {
    if (isGitSha(shortName)) {
        return (await hasCommit(shortName)) ? shortName : undefined;
    }
    const output = (await exec_1.getExecOutput('git', ['show-ref', shortName], { ignoreReturnCode: true })).stdout;
    const refs = output
        .split(/\r?\n/g)
        .map(l => l.match(/refs\/(?:(?:heads)|(?:tags)|(?:remotes\/origin))\/(.*)$/))
        .filter(match => match !== null && match[1] === shortName)
        .map(match => { var _a; return (_a = match === null || match === void 0 ? void 0 : match[0]) !== null && _a !== void 0 ? _a : ''; }); // match can't be null here but compiler doesn't understand that
    if (refs.length === 0) {
        return undefined;
    }
    const remoteRef = refs.find(ref => ref.startsWith('refs/remotes/origin/'));
    if (remoteRef) {
        return remoteRef;
    }
    return refs[0];
}
async function ensureRefAvailable(name) {
    core.startGroup(`Ensuring ${name} is fetched from origin`);
    try {
        let ref = await getLocalRef(name);
        if (ref === undefined) {
            await exec_1.getExecOutput('git', ['fetch', '--depth=1', '--no-tags', 'origin', name]);
            ref = await getLocalRef(name);
            if (ref === undefined) {
                await exec_1.getExecOutput('git', ['fetch', '--depth=1', '--tags', 'origin', name]);
                ref = await getLocalRef(name);
                if (ref === undefined) {
                    throw new Error(`Could not determine what is ${name} - fetch works but it's not a branch, tag or commit SHA`);
                }
            }
        }
        return ref;
    }
    finally {
        core.endGroup();
    }
}
function fixStdOutNullTermination() {
    // Previous command uses NULL as delimiters and output is printed to stdout.
    // We have to make sure next thing written to stdout will start on new line.
    // Otherwise things like ::set-output wouldn't work.
    core.info('');
}
const statusMap = {
    A: file_1.ChangeStatus.Added,
    C: file_1.ChangeStatus.Copied,
    D: file_1.ChangeStatus.Deleted,
    M: file_1.ChangeStatus.Modified,
    R: file_1.ChangeStatus.Renamed,
    U: file_1.ChangeStatus.Unmerged
};
