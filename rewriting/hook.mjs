import * as urls from './urls.mjs';
export const hook = `<script>
/* AUTHOR: Andrew X (ykS)  */
(function() {
    if (window.proxy_hook_nonce) {
        return;
    }
    window.proxy_hook_nonce = true;
    ${urls.encode_url.toString()}
    ${urls.decode_url.toString()}

    let path = new URL(window.location.href).pathname.split('/');
    path.splice(0, 2);
    let actual_location = new URL('https://www.example.com');
    for (let j = 0; j < path.length; j++) {
        actual_location = new URL(decode_url(path[j]), actual_location.href);
    }
    window.sanitize_value = function(input) {
        if ((input == window.location) || (input == document.location)) {
            return actual_location;
        }
        return input;
    };
    
    window.XMLHttpRequest.prototype.old_open = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function() {
        let args = arguments;
        if (args[1]) {
            args[1] = encode_url(args[1]);
        }
        return this.old_open(...args);
    }

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
                        return decode_url(to_return);
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
                    return decode_url(rewrite_descriptors.get.call(this));
                },
                configurable: true
            });
        }
    }

    let old_websocket = window.WebSocket;
    window.WebSocket = function() {
        let args = arguments;
        args[0] = 'wss://${urls.WEBSITE_BASE_URL}?url=' + encodeURIComponent(args[0]);
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

    let old_fetch = window.fetch;
    window.fetch = function() {
        let args = arguments;
        if (typeof args[0] == 'string' || args[0] instanceof String) {
            args[0] = encode_url(args[0]);
        }
        else if (args[0] instanceof URL) {
            args[0] = encode_url(args[0].href);
        }
        return old_fetch(...args);
    }

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
                return decode_url(descriptor.get.call(this));
            },
            configurable: true
        });
        return to_return;
    }
})();
</script>`;