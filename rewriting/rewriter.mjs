import { Worker } from 'worker_threads';

let NUM_WORKERS = 5;
let MAX_WORKER_TIME = 15000;
let WORKER_PATH = './rewriting/rewriter_worker.mjs';

let queue = [];
let workers = [];
for (let j = 0; j < NUM_WORKERS; j++) {
    workers[j] = {
        worker: new Worker(WORKER_PATH),
        worker_id: j,
        assigned_rewriter: undefined,
        assigned_time: 0
    };
    workers[j].worker.on('error', (err) => {
        console.log(err);
    })
    init_worker(workers[j]);
}
export class ContentRewriter {
    constructor(content_type, on_res, on_end, on_error) {
        this.content_type = content_type.toLowerCase();
        this.on_res = on_res;
        this.on_end = on_end;
        this.on_error = on_error;
        this.data = [];
    }
    write(data) {
        this.data.push(data);
    }
    end(data) {
        queue.push(this);
    }
    data_merged() {
        return Buffer.concat(this.data);
    }
}

function init_worker(worker_obj) {
    let on_error = function(error) {
        console.log("ERROR");
        console.log(error.stack);
        console.log(error.message);
        if (worker_obj.assigned_rewriter) { worker_obj.assigned_rewriter.on_error(error); }
        worker_obj.assigned_rewriter = undefined;
        worker_obj.worker = new Worker(WORKER_PATH);
        init_worker(worker_obj);
    };
    worker_obj.worker.on('error', on_error);
    worker_obj.worker.on('exit', on_error);
    worker_obj.worker.on('message', (msg) => {
        let rewriter = worker_obj.assigned_rewriter;
        if (!rewriter) { return; }
        if (msg instanceof Array) {
            if (msg[0] == 'end') {
                rewriter.on_end();
                worker_obj.assigned_rewriter = undefined;
            }
        }
        else {
            rewriter.on_res(Buffer.from(msg.buffer, msg.byteOffset, msg.length 
* msg.BYTES_PER_ELEMENT));
        }
    });
}
function assign_worker(worker, rewriter) {
    worker.assigned_rewriter = rewriter;
    worker.assigned_time = Date.now();
    worker.worker.postMessage(['rewrite_request', rewriter.content_type]);
    let data = rewriter.data_merged();
    let data_u8 = new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.length / Uint8Array.BYTES_PER_ELEMENT
    );
    
    worker.worker.postMessage(data_u8, [data_u8.buffer]);
}

setInterval(function() {
    for (let j = 0; j < workers.length; j++) {
        if (queue.length <= 0) { return; }
        if (typeof workers[j].assigned_rewriter != 'undefined') {
            if (Date.now() - workers[j].assigned_time <= MAX_WORKER_TIME) {
                continue;
            }
            // Terminate should emit the exit event on it's own
            // Until the exit event is triggered, we shall consider the worker
            // to still be busy, so we do not reset the assigned_rewriter
            workers[j].worker.terminate().catch(error => {
                console.log("Error killing worker: " + error.message);
            });
            continue;
        }
        assign_worker(workers[j], queue.shift());
    }
}, 100);