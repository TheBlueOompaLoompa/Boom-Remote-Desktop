<script>
	import { db, auth, googleProvider } from './firebase';

    import { authState } from 'rxfire/auth';

    let user;

    const unsubscribe = authState(auth).subscribe(u => user = u);

    function login() {
        auth.signInWithPopup(googleProvider);
    }

	const servers = {
		iceServers: [
			{
				urls: [
					'stun:stun.l.google.com:19302',
					'stun:stun1.l.google.com:19302',
				]
			},
			{
				urls: 'turn:192.168.1.4:3478',
				credential: 'A4@dvjPEhpJ7SjzZ',
				username: 'pi'
			}
		],
		iceCandidatePoolSize: 10,
	};

	// Global Sate
	const pc = new RTCPeerConnection(servers);
	let localStream = null;
	let remoteStream = null;

	let dataChannel;

	let isHost = false;

	let canvas;

	let ngrokServer = localStorage.getItem('ngrok') ? localStorage.getItem('ngrok') : '';

	function updateNgrok(){
		localStorage.setItem('ngrok', ngrokServer);
	}

	function startCapture(displayMediaOptions){
		let captureStream = null;

		return navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
			.catch(err => { console.error("Error:" + err); return null; });
	}

	// 1. Setup media sources
	async function startWebcam(remoteVideo){
		localStream = await startCapture({
			video: {
				cursor: 'never',
			},
			audio: true,
		});
		remoteStream = new MediaStream();
	
		// Push tracks from local stream to peer connection
		localStream.getTracks().forEach((track) => {
			pc.addTrack(track, localStream);
		});
	
		// Pull tracks from remote stream, add to video stream
		pc.ontrack = (event) => {
			event.streams[0].getTracks().forEach((track) => {
				remoteStream.addTrack(track);
				console.log('New user joined');
			});
		};

		return;
	}

	async function startRemote(remoteVideo) {
		localStream = new MediaStream();
		remoteStream = new MediaStream();
	
		// Push tracks from local stream to peer connection
		localStream.getTracks().forEach((track) => {
			pc.addTrack(track, localStream);
		});
	
		// Pull tracks from remote stream, add to video stream
		pc.ontrack = (event) => {
			event.streams[0].getTracks().forEach((track) => {
				remoteStream.addTrack(track);
				console.log('New user joined');
			});
		};

		return remoteStream;
	}

	// 2. Create an offer
	async function createOffer() {
		var socket = io(ngrokServer);
		dataChannel = pc.createDataChannel('Input');
		dataChannel.addEventListener('message', event => {
			try {
				socket.send(event['data']);
			} catch (e) {
				socket = io(ngrokServer);
			}
		});

		// Reference Firestore collections for signaling
		const callDoc = db.collection('calls').doc();
		const offerCandidates = callDoc.collection('offerCandidates');
		const answerCandidates = callDoc.collection('answerCandidates');

		// Get candidates for caller, save to db
		pc.onicecandidate = (event) => {
			event.candidate && offerCandidates.add(event.candidate.toJSON());
		};

		// Create offer
		const offerDescription = await pc.createOffer();
		await pc.setLocalDescription(offerDescription);
		
		const offer = {
			sdp: offerDescription.sdp,
			type: offerDescription.type,
		};

		await callDoc.set({ offer });

		// Listen for remote answer
		callDoc.onSnapshot((snapshot) => {
			const data = snapshot.data();
			if (!pc.currentRemoteDescription && data?.answer) {
				const answerDescription = new RTCSessionDescription(data.answer);
				pc.setRemoteDescription(answerDescription);
			}
		});

		// When answered, add candidate to peer connection
		answerCandidates.onSnapshot(snapshot => {
			snapshot.docChanges().forEach((change) => {
				if (change.type === 'added') {
					const candidate = new RTCIceCandidate(change.doc.data());
					pc.addIceCandidate(candidate);
				}
			});
		});

		return callDoc.id;
	}

	let mouseLimiter = 0;
	let mouseMax = 5;

	function debounce(func, wait, immediate) {
		var timeout;
		return function() {
			var context = this, args = arguments;
			var later = function() {
				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	};

	// 3. Answer the call with the unique ID
	async function answerCall(callId){
		pc.addEventListener('datachannel', event => {
			dataChannel = event.channel;
			dataChannel.addEventListener('open', (event) => {
				console.log('input data channel opened');
				if(!isHost){
					let x, y = 0;

					function getMousePos(canvas, evt) {
						var rect = canvas.getBoundingClientRect();
						return {
							x: (evt.clientX - rect.left) * (1920/(rect.right - rect.left)) + 1920,
							y: (evt.clientY - rect.top) * (1080/(rect.bottom - rect.top)),
						};
					}
					canvas.addEventListener('mousemove', function(evt) {
						console.log(mouseLimiter)
						if(mouseLimiter > mouseMax){
							({x, y} = getMousePos(canvas, evt));
							console.log('Mouse position: ' + x + ',' + y);
							dataChannel.send(JSON.stringify({type: 'mousemove', x, y}));
							mouseLimiter = 0;
						}
						mouseLimiter++;
					}, false);
					const debounceTime = 6;
					window.addEventListener('mousedown', debounce(() => {
						dataChannel.send(JSON.stringify({ type: 'lclick', direction: true}));
					}, debounceTime));
					window.addEventListener('mouseup', debounce(() => {
						dataChannel.send(JSON.stringify({ type: 'lclick', direction: false }));
					}, debounceTime));
					window.addEventListener('keydown', debounce(function(event) {
						let char = event.key;
						dataChannel.send(JSON.stringify({ type: 'key', char, direction: false }));
					}, false), debounceTime);
					window.addEventListener('keyup', debounce(function(event) {
						let char = event.key;
						dataChannel.send(JSON.stringify({ type: 'key', char: event.key, direction: true }));
					}, false), debounceTime);
				}
			});
		});
		
		const callDoc = db.collection('calls').doc(callId);
		const answerCandidates = callDoc.collection('answerCandidates');
		const offerCandidates = callDoc.collection('offerCandidates');

		pc.onicecandidate = (event) => {
			event.candidate && answerCandidates.add(event.candidate.toJSON());
		};

		const callData = (await callDoc.get()).data();

		const offerDescription = callData.offer;
		await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

		const answerDescription = await pc.createAnswer();
		await pc.setLocalDescription(answerDescription);

		const answer = {
			type: answerDescription.type,
			sdp: answerDescription.sdp,
		};

		await callDoc.update({ answer });

		offerCandidates.onSnapshot((snapshot) => {
			snapshot.docChanges().forEach((change) => {
			console.log(change);
			if (change.type === 'added') {
				let data = change.doc.data();
				pc.addIceCandidate(new RTCIceCandidate(data));
			}
			});
		});
	}

	let webcamEnabled = false;
	let callId = '';

	async function webcamInit(){
		let webcamVideo = document.getElementById('webcamVideo');
		let remoteVideo = document.getElementById('remoteVideo');
		canvas = document.getElementById('canvas');
		let ctx = canvas.getContext('2d');

		await startWebcam(remoteVideo);
		
		webcamVideo.muted = true;
		webcamEnabled = true;
	}

	async function remoteInit() {
		let remoteVideo = document.getElementById('remoteVideo');
		canvas = document.getElementById('canvas');
		let ctx = canvas.getContext('2d');

		let remoteStream = await startRemote(remoteVideo);
		
		remoteVideo.srcObject = remoteStream;

		remoteVideo.addEventListener('play', function () {
			var $this = this; //cache
			(function loop() {
				if (!$this.paused && !$this.ended) {
					ctx.drawImage($this, 0, 0, 1280, 720);
					setTimeout(loop, 1000 / 30); // drawing at 30fps
				}
			})();
		}, 0);

		webcamVideo.muted = true;
		document.getElementById('remoteVideo').srcObject = remoteStream;
		webcamEnabled = true;
	}
</script>

<svelte:head>
	<title>Boom</title>
</svelte:head>

<main>
	<span>Created by Benjamin Nack and beta tested by Logan Holt.</span>
	<a href="https://github.com/TheBlueOompaLoompa/Boom-Remote-Desktop">View this project on Github! <svg class="octicon octicon-mark-github v-align-middle" height="32" viewBox="0 0 16 16" version="1.1" width="32" aria-hidden="true"><path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg></a>
	<h2>Boom v1.2.0</h2>
	{#if user}
	<input type="url" bind:value={ngrokServer} on:change={updateNgrok} >
	<div class="videos">
		<span>
			<h3>Local</h3>
			<!-- svelte-ignore a11y-media-has-caption -->
			<video id="webcamVideo" autoplay=false playsinline></video>
		</span>
		<span>
			<h3>Remote</h3>
			<!-- svelte-ignore a11y-media-has-caption -->
			<video id="remoteVideo" autoplay=true playsinline></video>
		</span>
	</div>

	{#if webcamEnabled}
	
	<h2>Create a new Call</h2>
	<button on:click={async () => {callId = await createOffer()}}>&#x1F4F1;</button>

	<h2>Join a Call</h2>
	<input id="callInput" type="text" bind:value={callId} />
	<button on:click={() => {answerCall(callId)}}>&#x1F919;</button>
	<button on:click={() => {canvas.requestFullscreen()}}>Fullscreen</button>

	<button>&#x26D4;</button>
	{:else}
	<button on:click={webcamInit}>&#x1F5A5;</button>
	<button on:click={remoteInit}>&#x1F3AE;</button>
	{/if}
	<br>
	<canvas id="canvas" width="1280" height="720"></canvas>
	{:else}
	<button on:click={login}>
		Signin with Google
	</button>
	{/if}
</main>

<style>
	.videos {
		display: none;
	}
</style>