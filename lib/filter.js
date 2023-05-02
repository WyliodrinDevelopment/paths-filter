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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Filter = void 0;
const jsyaml = __importStar(require("js-yaml"));
const picomatch_1 = __importDefault(require("picomatch"));
// Minimatch options used in all matchers
const MatchOptions = {
    dot: true
};
class Filter {
    // Creates instance of Filter and load rules from YAML if it's provided
    constructor(yaml) {
        this.rules = {};
        if (yaml) {
            this.load(yaml);
        }
    }
    // Load rules from YAML string
    load(yaml) {
        if (!yaml) {
            return;
        }
        const doc = jsyaml.safeLoad(yaml);
        if (typeof doc !== 'object') {
            this.throwInvalidFormatError('Root element is not an object');
        }
        for (const [key, item] of Object.entries(doc)) {
            this.rules[key] = this.parseFilterItemYaml(item);
        }
    }
    match(files) {
        const result = {};
        for (const [key, patterns] of Object.entries(this.rules)) {
            result[key] = files.filter(file => this.isMatch(file, patterns));
        }
        return result;
    }
    isMatch(file, patterns) {
        return patterns.some(rule => (rule.status === undefined || rule.status.includes(file.status)) && rule.isMatch(file.filename));
    }
    parseFilterItemYaml(item) {
        if (Array.isArray(item)) {
            return flat(item.map(i => this.parseFilterItemYaml(i)));
        }
        if (typeof item === 'string') {
            return [{ status: undefined, isMatch: picomatch_1.default(item, MatchOptions) }];
        }
        if (typeof item === 'object') {
            return Object.entries(item).map(([key, pattern]) => {
                if (typeof key !== 'string' || (typeof pattern !== 'string' && !Array.isArray(pattern))) {
                    this.throwInvalidFormatError(`Expected [key:string]= pattern:string | string[], but [${key}:${typeof key}]= ${pattern}:${typeof pattern} found`);
                }
                return {
                    status: key
                        .split('|')
                        .map(x => x.trim())
                        .filter(x => x.length > 0)
                        .map(x => x.toLowerCase()),
                    isMatch: picomatch_1.default(pattern, MatchOptions)
                };
            });
        }
        this.throwInvalidFormatError(`Unexpected element type '${typeof item}'`);
    }
    throwInvalidFormatError(message) {
        throw new Error(`Invalid filter YAML format: ${message}.`);
    }
}
exports.Filter = Filter;
// Creates a new array with all sub-array elements concatenated
// In future could be replaced by Array.prototype.flat (supported on Node.js 11+)
function flat(arr) {
    return arr.reduce((acc, val) => acc.concat(val), []);
}
