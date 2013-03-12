# Doctor

Doctor is a self-contained directory management library for Node.js. This libary is based on the Simple Resource Protocol philosophy: one object to manage a single resource (or directory in this case). While it attempts to be "simple" (and is to some degree), this library can cause filesystem management to get complex, very fast. Proper usage can and will prevent this.

## Install

`npm install directory-doctor --save`
The `--save` will tell npm to add it to your `package.json`.

## Usage

To use `Doctor`, create a new object from the base class. The first argument is the path to the folder you want to use. If the folder doesn't exist, it is created. The second argument should be an options object. `Doctor` extends event emitter and before it can be used, you will need to wait for the "ready" event.

```js
var Doctor = require('directory-doctor'),
	d = new Doctor('my-folder');

d.on("ready", function() {
	// Do stuff here
});

d.on("error", function() {
	// Catch any async errors that might pop up
})
```

## Examples

`Doctor` maintains an internal cache of write streams to allow for semi-synchronous writes. In the example below, `Doctor` will create two writestreams for the two new files. If the folder `other` doesn't exist, it's created. To "flush" the cache and send `EOF` to all the streams, the async function `save` is called.

```js
d.set("other/one.txt", "Hullo!");
d.set("other/two.txt", "Two Hellos!");

d.save(function(err) {
	if (err) console.log(err.stack);
	else console.log("Done!");
});
```

Doctor is great for multiple files/directories as well. An object or array for the second arugment will cue Doctor to create a directory instead of a file. Filling the object with strings or buffers will fill the folder with those files. Passing a callback for the third argument tells Doctor to ignore the write cache and close the streams immediately.

```js
d.set("/", {
	"other": {
		"one.txt": "One.",
		"two.txt": "Two."
	},
	"a.txt": "Something for a...",
	"b.txt": "And then somethig for B!"
}, function(err) {
	if (err) console.log(err.stack);
	else d.get("other/one.txt", function(err, data) {
		if (err) console.log(err.stack);
		else console.log(data.toString());
	});
});
```

Doctor will return the writestream if you don't pass a callback. This can cause some weird filesystem write orders to happen. In the example below, `one.txt` would end up containing "Overwr Oh hai again." This is because the call to `one.write()` happens *after* the second call to `d.set()`.

```js
var one = d.set("other/one.txt", "Hullo!");
one.write(" Oh hai again.");
one.end();

d.set("other/one.txt", "Overwritten!");
```

Doctor also has synchronous versions of most of the major methods. Most are truly synchronous, except for `Doctor.replaceSync` which calls `Doctor.set()` internally (instead of `Doctor.setSync()`). Due to this, a `Doctor.save()` must be called after this function is run to flush the write cache.

```js
d.replaceSync([ "other/one.txt", "a.txt" ], function(file, stat) {
	return JSON.stringify(stat, null, "\t");
});

d.save(function(err) {
	if (err) console.log(err.stack);
	else console.log("Done!");
});
```

Doctor has a handleful other useful methods as well.

```js
// Watch all the files in the "other" folder, deeply.
d.watch("other/**", function(file, stat) {
	console.log(file + " changed...");
});

// Copy the folder "src" to the directory.
d.load("src", function(err) {
	if (err) console.log(err.stack);
	else console.log("Done!");
});

// Move the file "a.txt" to "../a-old.txt". CWD for this method is the `Doctor` object's location.
d.move("a.txt", "../a-old.txt", function(err) {
	if (err) console.log(err.stack);
	else console.log("Done!");
});
```