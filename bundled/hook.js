(() => {
  // hooks/base64.mjs
  function decode_payload(input) {
    let actual_input = decodeURIComponent(input);
    if (typeof atob !== "undefined") {
      return atob(actual_input);
    }
    return Buffer.from(actual_input, "base64").toString("utf8");
  }
  function encode_payload(input) {
    let actual_encoded = "";
    if (typeof btoa !== "undefined") {
      actual_encoded = btoa(input);
    } else {
      actual_encoded = Buffer.from(input).toString("base64");
    }
    return encodeURIComponent(actual_encoded);
  }

  // hooks/urls.mjs
  var WEBSITE_BASE_URL = "passthrough.ndrewxie.repl.co";
  var WEBSITE_URL = "https://" + WEBSITE_BASE_URL;
  var IS_ABSOLUTE = /^(?:[a-z+]+:)?\/\//;
  var PROXY_PROTOCOLS = ["https:", "http:"];
  function encode_url(url) {
    let actual_url = url;
    let fragment = "";
    try {
      let url_obj = new URL(actual_url, "https://www.example.com");
      let protocol = url_obj.protocol;
      if (!PROXY_PROTOCOLS.includes(protocol.toLowerCase())) {
        return actual_url;
      }
      if (typeof url_obj.hash != "undefined") {
        fragment = url_obj.hash;
      }
    } catch (e) {
      return actual_url;
    }
    actual_url = actual_url.replace(/(?:#[^#\/\?\.]*)*#[^#\/\?\.]*$/, "");
    let encoded = "";
    if (actual_url.length > 0) {
      if (IS_ABSOLUTE.test(actual_url)) {
        encoded = WEBSITE_URL + "/q/";
      }
      encoded += encode_payload(actual_url) + "/";
    }
    encoded += fragment;
    return encoded;
  }
  function decode_url(url) {
    let actual_url = url;
    if (!actual_url) {
      return url;
    }
    try {
      actual_url = actual_url.replace(/(?:#[^#\/\?\.]*)*#[^#\/\?\.]*$/, "");
      if (actual_url.length == 0) {
        return url;
      }
      let url_obj_in = new URL(actual_url, "https://example.com");
      if (!PROXY_PROTOCOLS.includes(url_obj_in.protocol.toLowerCase())) {
        return url;
      }
      let path = url_obj_in.pathname.split("/");
      if (path[0] == "") {
        path.splice(0, 1);
      }
      if (path.at(-1) == "") {
        path.pop();
      }
      if (path[0] != "q") {
        return decode_payload(path[0]);
      }
      path.splice(0, 1);
      let url_out = new URL("https://example.com");
      for (let j = 0; j < path.length; j++) {
        let decoded = decode_payload(path[j]);
        url_out = new URL(decoded, url_out.href);
      }
      url_out.hash = url_obj_in.hash;
      return url_out.href;
    } catch (e) {
      return url;
    }
  }

  // hooks/hook.mjs
  function stringify_type(input) {
    if (input instanceof URL || input instanceof Location) {
      return { href: input.href, type: "urlobj" };
    } else if (typeof input == "string" || input instanceof String) {
      return { href: input, type: "string" };
    }
    if (typeof trustedTypes != "undefined") {
      if (input instanceof TrustedScriptURL) {
        return { href: input.toString(), type: "trustedScriptURL" };
      }
    }
    return void 0;
  }
  function stringify_href(input) {
    let stringified = stringify_type(input);
    if (typeof stringified != "undefined") {
      return stringified.href;
    }
    return void 0;
  }
  function reconstitute_type(href, type) {
    if (type == "string") {
      return href;
    } else if (type == "urlobj") {
      return new URL(href);
    }
    if (typeof trustedTypes != "undefined") {
      if (type == "trustedScriptURL") {
        let policy = trustedTypes.createPolicy("passthrough", {
          createScriptURL: (url) => url
        });
        return policy.createScriptURL(href);
      }
    }
    return void 0;
  }
  function decode_url2(input) {
    let stringified = stringify_type(input);
    if (typeof stringified == "undefined") {
      return input;
    }
    let href = decode_url(stringified.href);
    return reconstitute_type(href, stringified.type);
  }
  function encode_url2(input) {
    let stringified = stringify_type(input);
    if (typeof stringified == "undefined") {
      return input;
    }
    let href = encode_url(stringified.href);
    return reconstitute_type(href, stringified.type);
  }
  window.decode_url = decode_url2;
  window.encode_url = encode_url2;
  function get_property_descriptor(base, name) {
    let current_node = base;
    while (current_node) {
      let descriptor = Object.getOwnPropertyDescriptor(current_node, name);
      if (descriptor) {
        return descriptor;
      }
      current_node = Object.getPrototypeOf(current_node);
    }
    return void 0;
  }
  var actual_location = new URL(stringify_href(decode_url2(window.location.href)));
  var actual_location_href = actual_location.href;
  var actual_location_descriptor = get_property_descriptor(actual_location, "href");
  Object.defineProperty(actual_location, "href", {
    enumerable: true,
    configurable: false,
    get() {
      return actual_location_href;
    },
    set(input) {
      actual_location_href = input;
      if (actual_location_descriptor && actual_location_descriptor.set) {
        actual_location_descriptor.set.call(actual_location, input);
      }
      window.location.href = encode_url2(input);
    }
  });
  actual_location.replace = function(input) {
    actual_location.href = input;
  };
  function sanitize_value(input) {
    if (input == window.location || input == document.location) {
      return actual_location;
    }
    return input;
  }
  window.sanitized_access = function(input_obj, input_prop, call_params) {
    if (typeof call_params === "undefined") {
      return sanitize_value(sanitize_value(input_obj)[input_prop]);
    } else {
      return sanitize_value(input_obj)[input_prop](...call_params);
    }
  };
  var attributes = ["href", "src", "srcset"];
  var special_proxy_targets = [
    [window.HTMLScriptElement, ["src"]]
  ];
  var script_remove_attributes = ["integrity", "nonce"];
  var window_keys = Object.getOwnPropertyNames(window);
  var processed_prototypes = [];
  for (let j = 0; j < window_keys.length; j++) {
    let current_node = window[window_keys[j]];
    if (!current_node) {
      continue;
    }
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
            args[1] = encode_url2(args[1]);
            break;
          }
        }
        if (!script_remove_attributes.includes(args[0].toLowerCase())) {
          this.old_set_attribute(...args);
        }
      };
    }
    if (!current_node.old_get_attribute) {
      current_node.old_get_attribute = current_node.getAttribute;
      current_node.getAttribute = function() {
        let to_return = this.old_get_attribute(...arguments);
        for (let k = 0; k < rewrite_attr_list.length; k++) {
          if (arguments[0].toLowerCase() == rewrite_attr_list[k].toLowerCase()) {
            return stringify_href(decode_url2(to_return));
          }
        }
        return to_return;
      };
    }
    for (let k = 0; k < rewrite_attr_list.length; k++) {
      let rewrite_descriptors = Object.getOwnPropertyDescriptor(current_node, rewrite_attr_list[k]);
      if (!rewrite_descriptors) {
        continue;
      }
      Object.defineProperty(current_node, rewrite_attr_list[k], {
        set: function(input) {
          rewrite_descriptors.set.call(this, encode_url2(input));
        },
        get: function() {
          return stringify_href(decode_url2(rewrite_descriptors.get.call(this)));
        },
        configurable: true
      });
    }
  }
  var old_websocket = window.WebSocket;
  window.WebSocket = function() {
    let args = arguments;
    args[0] = `wss://${WEBSITE_BASE_URL}?url=` + encodeURIComponent(args[0]);
    return new old_websocket(...args);
  };
  window.navigator.serviceWorker.old_sw_register = window.navigator.serviceWorker.register;
  window.navigator.serviceWorker.register = function() {
    let args = arguments;
    args[0] = encode_url2(args[0]);
    return this.old_sw_register(...args);
  };
  function hook_iframe_ws(input) {
    if (!input || !input.tagName) {
      return;
    }
    if (input.tagName.toLowerCase() != "iframe") {
      return;
    }
    if (!input.contentWindow) {
      return;
    }
    input.contentWindow.WebSocket = WebSocket;
  }
  var append_points = [
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
    };
    to_modify.old_prepend = to_modify.prepend;
    to_modify.prepend = function() {
      this.old_prepend(...arguments);
      hook_iframe_ws(arguments[0]);
    };
  }
  window.XMLHttpRequest.prototype.old_open = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function() {
    let args = arguments;
    if (args[1]) {
      args[1] = encode_url2(args[1]);
    }
    return this.old_open(...args);
  };
  var old_fetch = window.fetch;
  var FETCH_EXCLUDE_COPIES = ["referrer", "referrerPolicy", "integrity"];
  var FETCH_REQUEST_COPIES = ["method", "headers", "body", "mode", "credentials", "cache", "redirect", "keepalive", "signal"];
  window.fetch = function(url, options) {
    let actual_url = void 0;
    let actual_options = {
      method: "GET",
      headers: new Headers()
    };
    if (url instanceof Request) {
      let options_obj = {};
      if (typeof url.body != "undefined" && url.body != null) {
        options_obj.duplex = "half";
      }
      for (const field of FETCH_REQUEST_COPIES) {
        if (typeof url[field] == "undefined") {
          continue;
        }
        options_obj[field] = url[field];
      }
      actual_url = new Request(encode_url2(url.url), options_obj);
      actual_options = void 0;
    } else {
      actual_url = encode_url2(url);
      actual_options = {};
      for (const field in options) {
        if (FETCH_EXCLUDE_COPIES.includes(field)) {
          continue;
        }
        actual_options[field] = options[field];
      }
    }
    return old_fetch(actual_url, actual_options);
  };
})();
