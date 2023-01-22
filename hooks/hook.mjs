import * as urls from './urls.mjs';

function stringify_type(input) {
    if ((input instanceof URL) || (input instanceof Location)) {
        return { href: input.href, type: 'urlobj' };
    }
    else if ((typeof input == 'string') || (input instanceof String)) {
        return { href: input, type: 'string' };
    }
    if (typeof trustedTypes != 'undefined') {
        if (input instanceof TrustedScriptURL) {
            return { href: input.toString(), type: 'trustedScriptURL' };
        }
    }
    return undefined;
}
function stringify_href(input) {
    let stringified = stringify_type(input);
    if (typeof stringified != 'undefined') {
        return stringified.href;
    }
    return undefined;
}
function reconstitute_type(href, type) {
    if (type == 'string') {
        return href;
    }
    else if (type == 'urlobj') { // ok, as absoluteness is invariant under encode_url
        return new URL(href);
    }
    if (typeof trustedTypes != 'undefined') {
        if (type == 'trustedScriptURL')  {
            let policy = trustedTypes.createPolicy("passthrough", {
                createScriptURL: (url) => url
            });
            return policy.createScriptURL(href);
        }
    }
    return undefined;
}
function decode_url(input) {
    let stringified = stringify_type(input);
    if (typeof stringified == 'undefined') { return input; }
    let href = urls.decode_url(stringified.href);
    return reconstitute_type(href, stringified.type);
}
function encode_url(input) {
    let stringified = stringify_type(input);
    if (typeof stringified == 'undefined') { return input; }
    let href = urls.encode_url(stringified.href);
    return reconstitute_type(href, stringified.type);
}

window.decode_url = decode_url;
window.encode_url = encode_url;

function get_property_descriptor(base, name) {
    let current_node = base;
    while (current_node) {
        let descriptor = Object.getOwnPropertyDescriptor(current_node, name);
        if (descriptor) {
            return descriptor;
        }
        current_node = Object.getPrototypeOf(current_node);
    }
    return undefined;
}

let actual_location = new URL(stringify_href(decode_url(window.location.href)));
let actual_location_href = actual_location.href;
let actual_location_descriptor = get_property_descriptor(actual_location, 'href');
Object.defineProperty(actual_location, 'href', {
    enumerable: true,
    configurable: false,
    get() { return actual_location_href },
    set(input) {
        actual_location_href = input;
        if (actual_location_descriptor && actual_location_descriptor.set) {
            actual_location_descriptor.set.call(actual_location, input);
        }
        window.location.href = encode_url(input);
    }
});
actual_location.replace = function(input) { actual_location.href = input; };

function sanitize_value(input) {
    if ((input == window.location) || (input == document.location)) {
        return actual_location;
    }
    return input;
};
window.sanitized_access = function(input_obj, input_prop, call_params) {
    if (typeof call_params === 'undefined') {
        return sanitize_value(sanitize_value(input_obj)[input_prop]);
    }
    else {
        return sanitize_value(input_obj)[input_prop](...call_params);
    }
}

const attributes = ['href', 'src', 'srcset'];
const special_proxy_targets = [
    [window.HTMLScriptElement, ['src']]
];
const script_remove_attributes = ['integrity', 'nonce'];

let window_keys = Object.getOwnPropertyNames(window);
let processed_prototypes = [];
for (let j = 0; j < window_keys.length; j++) {
    let current_node = window[window_keys[j]];
    if (!current_node) { continue; }
    current_node = current_node.prototype;
    
    if (processed_prototypes.includes(current_node)) {
        continue;
    }
    processed_prototypes.push(current_node);

    let should_rewrite = false;
    let rewrite_attr_list = attributes;

    for (let k = 0; k < special_proxy_targets.length; k++) {
        if (special_proxy_targets[k][0].prototype == current_node) {
            rewrite_attr_list = special_proxy_targets[k][1];
            should_rewrite = true;
            break;
        }
    }

    if (!should_rewrite) {
        while (current_node) {
            current_node = Object.getPrototypeOf(current_node);
            if (current_node == window.Element.prototype) {
                should_rewrite = true;
                break;
            }
        }
        current_node = window[window_keys[j]].prototype;
    }
    if (!(should_rewrite && current_node)) {
        continue;
    }
    
    if (!current_node.old_set_attribute) {
        current_node.old_set_attribute = current_node.setAttribute;
        current_node.setAttribute = function() {
            let args = arguments;
            for (let k = 0; k < rewrite_attr_list.length; k++) {
                if (args[0].toLowerCase() == rewrite_attr_list[k].toLowerCase()) {
                    args[1] = encode_url(args[1]);
                    break;
                }
            }
            if (!script_remove_attributes.includes(args[0].toLowerCase())) {
                this.old_set_attribute(...args);
            }
        }
    }
    if (!current_node.old_get_attribute) {
        current_node.old_get_attribute = current_node.getAttribute;
        current_node.getAttribute = function() {
            let to_return = this.old_get_attribute(...arguments);
            for (let k = 0; k < rewrite_attr_list.length; k++) {
                if (arguments[0].toLowerCase() == rewrite_attr_list[k].toLowerCase()) {
                    return stringify_href(decode_url(to_return));
                }
            }
            return to_return;
        }
    }

    for (let k = 0; k < rewrite_attr_list.length; k++) {
        let rewrite_descriptors = Object.getOwnPropertyDescriptor(current_node, rewrite_attr_list[k]);
        if (!rewrite_descriptors) {
            continue;
        }
        Object.defineProperty(current_node, rewrite_attr_list[k], {
            set: function(input) {
                rewrite_descriptors.set.call(this, encode_url(input));
            },
            get: function() {
                return stringify_href(decode_url(rewrite_descriptors.get.call(this)));
            },
            configurable: true
        });
    }
}

let old_websocket = window.WebSocket;
window.WebSocket = function() {
    let args = arguments;
    args[0] = `wss://${urls.WEBSITE_BASE_URL}?url=` + encodeURIComponent(args[0]);
    return new old_websocket(...args);
}

window.navigator.serviceWorker.old_sw_register = window.navigator.serviceWorker.register;
window.navigator.serviceWorker.register = function() {
    let args = arguments;
    args[0] = encode_url(args[0]);
    return this.old_sw_register(...args);
}

function hook_iframe_ws(input) {
    if ((!input) || (!input.tagName)) {
        return;
    }
    if (input.tagName.toLowerCase() != 'iframe') {
        return;
    }
    if (!input.contentWindow) {
        return;
    }
    input.contentWindow.WebSocket = WebSocket;
}

let append_points = [
    window.Element.prototype,
    document
];
for (let j = 0; j < append_points.length; j++) {
    let to_modify = append_points[j];
    to_modify.old_appendchild = to_modify.appendChild;
    to_modify.appendChild = function() {
        let to_return = this.old_appendchild(...arguments);
        hook_iframe_ws(arguments[0]);
        return to_return;
    }
    to_modify.old_prepend = to_modify.prepend;
    to_modify.prepend = function() {
        this.old_prepend(...arguments);
        hook_iframe_ws(arguments[0]);
    }
}

window.XMLHttpRequest.prototype.old_open = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function() {
    let args = arguments;
    if (args[1]) {
        args[1] = encode_url(args[1]);
    }
    return this.old_open(...args);
}

let old_fetch = window.fetch;
const FETCH_EXCLUDE_COPIES = ['referrer', 'referrerPolicy', 'integrity'];
const FETCH_REQUEST_COPIES = ['method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'keepalive', 'signal'];
window.fetch = function(url, options) {
    let actual_url = undefined
    let actual_options = {
        method: 'GET',
        headers: new Headers()
    };
    
    if (url instanceof Request) {
        let options_obj = {};
        if ((typeof url.body != 'undefined') && (url.body != null)) {
            // Due to a chrome bug, duplex isn't actually exposed as a property
            // There shouldn't (?) be much harm in always setting duplex if there's a body,
            // so this is a temporary workaround
            options_obj.duplex = 'half';
        }
        for (const field of FETCH_REQUEST_COPIES) {
            if (typeof url[field] == 'undefined') { continue; }
            options_obj[field] = url[field];
        }
        actual_url = new Request(encode_url(url.url), options_obj);
        actual_options = undefined;
    }
    else {
        actual_url = encode_url(url);
        actual_options = {};
        for (const field in options) {
            if (FETCH_EXCLUDE_COPIES.includes(field)) { continue; }
            actual_options[field] = options[field];
        }
    }

    return old_fetch(actual_url, actual_options);
}

/*
let old_request = window.Request;
window.Request = function() {
    let args = arguments;
    if (typeof args[0] == 'string' || args[0] instanceof String) {
        args[0] = encode_url(args[0]);
    }
    let to_return = new old_request(...args);
    let descriptor = get_property_descriptor(to_return, 'url');
    Object.defineProperty(to_return, 'url', {
        get: function() {
            return stringify_href(decode_url(descriptor.get.call(this)));
        },
        configurable: true
    });
    return to_return;
}
*/

/*
window.addEventListener('error', function(event) {
    alert("ERROR");
    alert(event.message);
    prompt('filename', event.filename);
    alert(event.lineno);
    alert(event.colno);
});
*/