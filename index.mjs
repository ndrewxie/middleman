import * as fs from 'fs';
import * as ws from 'ws';
import * as http from 'http';
import * as https from 'https';
import * as urls from './hooks/urls.mjs';
import * as hook from './hooks/build.mjs';
import * as headers from './headers.mjs';
import { ContentRewriter } from './rewriting/rewriter.mjs';
import { guess_mime } from './mimes.mjs';
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

await hook.build();

let static_server = http.createServer(function (req, res) {
    if (req.url.includes('/q/')) {
        try {
            make_request(req, res);
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
function make_request(req, res) {
    let requested_url = urls.decode_url(req.url);
    let protocol = new URL(requested_url).protocol;
    let options = {
        method: req.method,
        headers: headers.get_headers(req.url, req.headers)
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
    
    let resource_request = requester.request(requested_url, options,
        (requested_data) => { process_res(requested_data, res, requested_url); }
    );
    req.on('data', (chunk) => { resource_request.write(chunk); });
    req.on('end', () => { resource_request.end(); });
    req.on('close', () => { resource_request.end(); });
    resource_request.on('error', e => {
        console.log('Failed in make_request: ' + e.message + ': ');
        console.log(options.method + ': ' + requested_url);
        res.statusCode = 404;
        res.end();
    });
}
function process_res(requested_data, res, requested_url) {
    try {
        if (redirect_codes.includes(requested_data.statusCode)) {
            let encoded_redirect = urls.encode_url(requested_data.headers['location']);
            res.writeHead(requested_data.statusCode, {
                'Location': encoded_redirect
            });
            res.end();
            return;
        }

        let response_headers = headers.get_response_headers(
            requested_data.headers,
            function(content_type) {
                return content_type && (
                    content_type.includes('html') ||
                    content_type.includes('css') ||
                    content_type.includes('javascript')
                );
            }
        );
        for (const header in response_headers.headers) {
            res.setHeader(header, response_headers.headers[header]);
        }
        res.writeHead(requested_data.statusCode);

        let transformer = undefined;
        if (response_headers.is_rewritten) {
            transformer = new ContentRewriter(
                response_headers.content_type, 
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