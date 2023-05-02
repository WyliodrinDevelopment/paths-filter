"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvEscape = void 0;
// Returns filename escaped for CSV
// Wraps file name into "..." only when it contains some potentially unsafe character
function csvEscape(value) {
    if (value === '')
        return value;
    // Only safe characters
    if (/^[a-zA-Z0-9._+:@%/-]+$/m.test(value)) {
        return value;
    }
    // https://tools.ietf.org/html/rfc4180
    // If double-quotes are used to enclose fields, then a double-quote
    // appearing inside a field must be escaped by preceding it with
    // another double quote
    return `"${value.replace(/"/g, '""')}"`;
}
exports.csvEscape = csvEscape;
