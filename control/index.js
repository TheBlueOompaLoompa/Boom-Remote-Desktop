const robot = require('robotjs');
const http = require('http').createServer();
const io = require('socket.io')(http, {
	cors: { origin: "*" }
});

io.on('connection', socket => {
	socket.on('message', msg => {
		var data = JSON.parse(msg);
		console.log(data)

		switch(data['type']) {
			case 'mousemove':
				robot.moveMouse(data.x, data.y);
				break;
			case 'lclick':
				robot.mouseToggle(data.direction ? 'down' : 'up', 'left');
				break;
			case 'key':
				robot.keyToggle(data.char.toLowerCase().replace('arrow', ''), data.direction ? 'up' : 'down' );
				break;
		}
	});
})

http.listen(8080, () => console.log('listening on http://localhost:8080'));