import { Worker } from 'worker_threads';

let NUM_WORKERS = 12;
let MAX_WORKER_TIME = 30000;
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
        console.log("Error in worker");
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
    while (queue.length > 0) {
        let assigned = false;
        let overtime_worker = undefined;
        for (let j = 0; j < workers.length; j++) {
            let worker = workers[j];
            if (typeof worker.assigned_rewriter != 'undefined') {
                if (Date.now() - worker.assigned_time >= MAX_WORKER_TIME) {
                    overtime_worker = j;
                }
                continue;
            }
            assign_worker(worker, queue.shift());
            assigned = true;
            break;
        }
        // Already assigned a worker, so moving on to next queue entry
        if (assigned) { continue; }

        // Can't assign a worker, but we do have a worker that's overtime
        // We can terminate this worker and then use it in the next iteration
        // of the loop
        if (typeof overtime_worker != 'undefined') {
            workers[j].worker.terminate().catch(error => {
                console.log("Error killing worker: " + error.message);
            });
            continue;
        }
        // Can't assign a worker, and no overtime workers. Quitting
        break;
    }
}, 100);