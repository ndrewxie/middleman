import { readFileSync } from 'fs';

const NESTING_DEPTH = 10;
const SUS_ATTRIBUTES = [
    '[',
    ']',
    'href',
    'location',
    'hostname'
];
//const SANITIZE_STR = '(window.sanitize_value || function(eTadQ2) { return eTadQ2; })('
const SANITIZE_STR = 'window.sanitize_value('

// \[(:?[^\"'\]`]|(?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*')|(?:\`(?:[^\`\\]\\\.)*\`))*\]
// \[(?:(?:[^\"'\]`/][^\"'\]`])|(?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*')|(?:\`(?:[^\`\\]|\\.)*`)|(?:\/\*(\*(?!\/)|[^*])*\*\/))*\]

let ws = `(?:\\s*)`;

let quoted_string = `(?:` + `(?:"(?:[^"\\\\]|\\\\.)*")|(?:'(?:[^'\\\\]|\\\\.)*')|(?:\`(?:[^\`\\\\]|\\\\.)*\`)` + `)`;
let comment = `(?:` + `\\/\\*(\\*(?!\\/)|[^*])*\\*\\/` + `)`;

let boundary = `(?:^|[^0-9a-zA-Z$_.])`;
let identifier = `(?!(?:break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|throw|true|try|typeof|var|void|while|with|let|static|yield|await|enum|implements|interface|package|private|protected|public)(?:[^0-9a-zA-Z$_]|$))(?:[a-zA-Z$_][0-9a-zA-Z$_]*)`;
let assignment_operators = `(?:=|\\+=|-=|\\*=|\\/=|%=|\\*\\*=|<<=|>>=|>>>=|&=|\\^=|\\|=|\\+\\+|--)`;

let number = `(?:` + `(?:\\d+(?:\\.\\d*)?)|(?:0x[0-9a-fA-F]+)` + `)`;
let simple_value = `(?:${identifier}|${quoted_string}|${number})`;
let legal_in_bracket_char = `(?:[^\\"'\\]\`/][^\\"'\\]\`]??)`;
let matching_braces = `(?:` + `\\[${ws}(?:${legal_in_bracket_char}|${quoted_string}|${comment})*${ws}\\]` + `)`;

let property_access = `((?:${ws}\\.${ws}${identifier})|(?:${ws}\\[${ws}${simple_value}${ws}\\]))`;
//let property_access = `((?:${ws}\\.${ws}${identifier})|(?:${ws}${matching_braces}))`;
let property_access_repeated = property_access;
for (let j = 0; j < NESTING_DEPTH-1; j++) {
    property_access_repeated += property_access + '?';
}
let final_regex = 
    `${boundary}(${identifier}${ws}${property_access_repeated})` + 
    `(?!${ws}${assignment_operators})(?![0-9a-zA-Z$_])${ws}(?:(?<FunctionCall>\\()?)`;

let proxy_regex = new RegExp(final_regex, 'gd');
let quote_regex = new RegExp(quoted_string, 'gd');

export class JSRewriter {
    constructor(input) {
        this.input = input;
        this.rewrites = [];
    }
    rewrite() {
        this.parse();
        let acc = '';
        let last_copied_index = 0;
        for (let j = 0; j < this.rewrites.length; j++) {
            let rewrite = this.rewrites[j];
            acc += this.input.substring(last_copied_index, rewrite.from);
            acc += rewrite.text;
            last_copied_index = rewrite.to;
        }
        acc += this.input.substring(last_copied_index, this.input.length);
        return acc;
    }
    parse() {
        let result = [...this.input.matchAll(proxy_regex)];
        let string_indices = [...this.input.matchAll(quote_regex)];
        let last_string_index = 0;
        for (let j = 0; j < result.length; j++) {
            // We need to rewrite asdf["bsdf"].c['d'][5] into:
            // proxy(proxy(proxy(proxy(proxy(asdf)["bsdf"]).c)['d'])[5])
            let entry = result[j];
            let has_function_call = entry.groups && entry.groups.FunctionCall;

            let last_string = string_indices[last_string_index];
            if (typeof last_string != 'undefined') {
                let str_indx = last_string.indices[0];
                let curr_indx = entry.indices[0];
                if (curr_indx[0] >= str_indx[0]) {
                    if (curr_indx[1] <= str_indx[1]) {
                        continue;
                    }
                    last_string_index += 1;
                }
            }
            
            let access_start_indx = 2;
            let max_index = 0;
            for (let k = access_start_indx; k < access_start_indx + NESTING_DEPTH; k++) {
                if (typeof entry[k] == 'undefined') { break; }
                max_index = k;
            }
            if (has_function_call) { max_index -= 1; }
            
            let proxy_start = SANITIZE_STR;
            let can_bail = true;
            for (let k = access_start_indx; k <= max_index; k++) {
                SUS_ATTRIBUTES.forEach((elem) => {
                    if (entry[k].includes(elem)) { can_bail = false; }
                });
                proxy_start += SANITIZE_STR;
            }
            if (can_bail) { continue; }
            this.rewrites.push({ from: entry.indices[1][0], to: entry.indices[1][0], text: proxy_start });
            
            let last_paren_location = entry.indices[access_start_indx][0];
            for (let k = access_start_indx; k <= max_index; k++) {
                let index = entry.indices[k];
                this.rewrites.push({ from: index[0], to: index[0], text: ')' });
                last_paren_location = index[1];
            }
            this.rewrites.push({ from: last_paren_location, to: last_paren_location, text: ')' });
        }
    }
}

//let rewriter = new JSRewriter('for(n=0;n<t;n++)i[r[n]]=s[n];return i}');
//console.log(rewriter.rewrite());

(function() {
    return;
    let data = readFileSync('./moomoo.js', { encoding: 'utf8' });
    let rewriter = new JSRewriter(data);
    console.log(rewriter.rewrite()); 
})();