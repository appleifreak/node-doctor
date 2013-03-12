var Doctor = module.exports = require('./lib/doctor');

var d = new Doctor('test'),
	_ = require('underscore');

d.on("ready", function() {
	d.setSync("/", {
		"my-folder": [ "file1.txt", "file2.txt" ],
		"hello.js": "console.log('Hello World');"
	});

	console.log(d.getSync("my-folder"));
});