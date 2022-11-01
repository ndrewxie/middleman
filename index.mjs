import * as fs from 'fs';
import * as ws from 'ws';
import * as http from 'http';
import * as https from 'https';
import * as urls from './rewriting/urls.mjs';
import { ContentRewriter } from './rewriting/rewriter.mjs';
import { guess_mime } from './mimes.mjs';
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

let static_server = http.createServer(function (req, res) {
    if (req.url.includes('/reqs/')) {
        try {
            let path = req.url.split('/');
            path.splice(0, 2);
            let request_url = 'https://www.example.com';
            for (let j = 0; j < path.length; j++) {
                request_url = new URL(urls.decode_url(path[j]), request_url).href;
            }
            let base_url = (!!path[0]) ? urls.decode_url(path[0]) : 'https://www.example.com';
            
            let headers = {};
            try {
                headers = get_headers(req.headers, base_url);
            } catch (e) {}
            make_request(request_url, headers, req.method, res);
        }
        catch (e) {
            console.log("Error in initial processing of " + req.url);
            console.log("Message: " + e.message);
            res.writeHead(404);
            res.end();
        }
    }
    else {
        let requested_path = (req.url == '/') ? '/index.html' : req.url;
        fs.readFile('./client' + requested_path, (err, data) => {
            if (!err) {
                res.writeHead(200, { 'Content-Type': guess_mime(requested_path) });
                res.write(data.toString());
                res.end();
                return;
            }
            res.writeHead(404);
            res.end();
            console.log("Static server error: " + req.url);
        });
    }
});

const redirect_codes = [301, 302, 303, 307, 308];
function make_request(requested_url, headers, method, res) {
    let protocol = new URL(requested_url).protocol;
    let options = {
        method: method,
        headers: headers
    };
    let requester = undefined;
    if (protocol == 'http:') {
        options.port = 80;
        requester = http;
    }
    else if (protocol == 'https:') {
        options.port = 443;
        requester = https;
    }
    else {
        throw new Error("Unsupported protocol: " + protocol);
    }
    
    let req = requester.request(requested_url, options,
        (requested_data) => { process_res(requested_data, res, requested_url, options) }
    );
    req.on('error', e => {
        console.log('Failed in make_request: ' + e.message + ': ');
        console.log(options.method + ': ' + requested_url);
        res.statusCode = 404;
        res.end();
    });
    req.end();
}
function process_res(requested_data, res, requested_url, options) {
    try {
        if (redirect_codes.includes(requested_data.statusCode)) {
            let encoded_redirect = urls.encode_url(requested_data.headers['location']);
            res.writeHead(requested_data.statusCode, {
                'Location': encoded_redirect
            });
            res.end();
            return;
        }
        
        let content_type = requested_data.headers['content-type'];
        if (content_type) { res.setHeader('Content-Type', content_type); }
        res.writeHead(requested_data.statusCode);

        let transformer = undefined;
        if (content_type && (
            content_type.includes('html') ||
            content_type.includes('css') ||
            content_type.includes('javascript')
        )) {
            content_type = content_type.toLowerCase();
            transformer = new ContentRewriter(
                content_type, 
                function(chunk) { res.write(chunk); }, 
                function() { res.end(); }, 
                function(e) {
                    console.log("ERROR: " + e.message); 
                    console.log(e.stack);
                    res.statusCode = 404; 
                    res.end();
                }
            );
        }
        if (typeof transformer == 'undefined') { transformer = res; }
        
        requested_data.on('data', chunk => { transformer.write(chunk); });
        requested_data.on('close', () => { transformer.end(); });
    } catch(e) {
        console.log("failed: " + e.message);
        console.log(e.stack);
        console.log(requested_url);
        res.statusCode = 404;
        res.end();
    }
}

let proxy_skip_headers = [
    'host',
    'referer',
    'origin',
    'accept-encoding',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-replit-user-id',
    'x-replit-user-name',
    'x-replit-user-roles'
]
function get_headers(input, base_url) {
    let to_return = {};
    for (const key in input) {
        let to_copy = true;
        for (let j = 0; j < proxy_skip_headers.length; j++) {
            if (key.toLowerCase() == proxy_skip_headers[j].toLowerCase()) {
                to_copy = false;
                break;
            }
        }
        if (to_copy) {
            to_return[key] = input[key];
        }
    }
    
    let base_info = new URL(base_url);
    to_return['Referer'] = base_info.href;
    to_return['Origin'] = base_info.origin;
    
    return to_return;
}

let websocket_server = new ws.WebSocketServer({
    server: static_server
});
websocket_server.on('connection', function (client, req) {
    try {
        let to_parse = new URL(urls.WEBSITE_URL + req.url);
        let requested_url = decodeURIComponent(to_parse.searchParams.get('url'));
        let headers = {};
        if (req.headers['user-agent']) {
            headers['user-agent'] = req.headers['user-agent'];
        }
        let server = new ws.WebSocket(requested_url, {
            rejectUnauthorized: false,
            followRedirects: true,
            headers: headers
        });
        server.on('message', function(msg, is_binary) {
            client.send(msg, {
                binary: is_binary
            });
        });
        server.on('open', function() {
            client.on('message', function(msg, is_binary) {
                server.send(msg, {
                    binary: is_binary
                });
            });
            client.on('close', function() {
                server.close();
            });
            client.on('pong', function(payload) {
                server.pong(payload);
            });
        });
        server.on('ping', function(payload) {
            client.ping(payload);
        });
        server.on('error', function(e) {
            console.log("WS SERVER ERROR: ");
            console.log(e.message);
            console.log(e.stack);
        });
    }
    catch(e) {
        console.log("WS ERROR");
    }
});
static_server.listen(8080);

console.log("Ready");