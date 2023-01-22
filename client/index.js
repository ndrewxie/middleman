function run_prox() {                
	let target_url = document.getElementById('proxurl').value;
	if (target_url.length <= 0) {
		alert("Please enter a URL");
		return;
	}
	try { let temp_url = new URL(target_url); }
	catch(e) {
		alert("Please enter a properly formatted URL. It should start with a protocol (for example, https://), and should contain an extension (for example, .com, .org, .net, .edu)");
		return;
	}

	let encoded_target = encodeURIComponent(btoa(target_url));
	let to_redirect = new URL('/q/' + encoded_target + '/', window.location.href);
	window.location.href = to_redirect.href;
}

let task_list = [];
function add_task_internal(task) {
    if (!task) { return; }
    task_list.push(task);
    let index = task_list.length-1;
    let task_div = document.createElement('div');
    task_div.innerText = task;
    task_div.classList.add('text-large', 'task-label');
    task_div.addEventListener('click', function() {
        document.getElementById('notepad').removeChild(task_div);
        task_list[index] = undefined;
    });
    document.getElementById('notepad').prepend(task_div);
}

function add_task() {
    let value = document.getElementById('todoitem').value;
    if (value == 'login') {
        document.getElementById('notepad').classList.add('hidden');
        document.getElementById('mainpage').classList.remove('hidden');
        return;
    }
    add_task_internal(value);
    document.getElementById('todoitem').value = '';
}

setInterval(function() {
    let saved = JSON.stringify(task_list);
    localStorage.setItem('tasklist39292', saved);
}, 1000);

let savedata = JSON.parse(localStorage.getItem('tasklist39292'));
if (savedata) {
    for (let j = 0; j < savedata.length; j++) {
        add_task_internal(savedata[j]);
    }
}