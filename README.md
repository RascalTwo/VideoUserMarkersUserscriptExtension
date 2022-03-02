# R2 Twitch User-Markers

Do you wish you, average Twitch user, could add markers to Twitch VODs - both live and after the fact? Well this is the userscript for you!

https://user-images.githubusercontent.com/9403665/155326353-e6eca746-ebb3-421b-99d1-674666e4554d.mp4

This userscript allows users to add markers to a VOD, additionally allowing the adjustment of all added markers, combined with easy importing and exporting of the marker data.

> I personally use ViolentMonkey to manage my userscripts, but this should be compatible with all the userscript managers available

## Installation

- Create a new UserScript
- Copy the contents of [`dist/userscript.js`](../../blob/dist/dist/userscript.js) into it

### Building

This is written in TypeScript, so after running `npm install`, one can run `npm run build` to generate the [`dist/userscript.js`](../../blob/dist/dist/userscript.js) file.

## Usage

When you're on a valid page `R2 Markers` will appear below the bottom-right corner of the video.

From there you can add a new marker, or open the menu - which allows you to import/export and view the marker list.

> When adding a new marker, a shareable link for the marker is copied to your clipboard.

In addition, the current marker name is visible just right of the player volume control.

### Export

Copies the textual marker content to your clipboard.

### Edit

Allows direct editing of the marker text, so you can delete lines to remove markers, add lines to add markers, and easily import by pasting your previously created markers here.

### VOD-Only

All marker markers are visible on the timeline, in addition to the marker name being shown while seeking said timeline.

Scrolling while moused over the timeline also allows for seeking one second at a time.

### Marker List

From here you can see all the added markers, manually obtain their sharable links, delete them, and edit both their titles and timestamps.

Editing is done by right-clicking either the name or timestamp.

The timestamp also supports scrolling to edit; scrolling up decreases the time by one second, and down increased it by one second.

You can both resize the chapter list - resize control is in the bottom-right - and click-and-drag anywhere to drag the list to your preferred position.

### VOD

When adjusting the timestamp of a marker, the player automatically seeks to the newly-set timestamp, so you can see in realtime if it's where you desire it to be.

## Keyboard Shortcuts

The most general one is the `Escape` key, which will close any open dialogs.

- `b`
  - Add a new marker
- `m`
  - Open the Menu

### Marker List

These shortcuts exist only when the marker list is open:

- `w`/`s`
  - Go to the previous/next marker
- `a`/`d`
  - Decrement/Increment of current marker by one seconds
- `q`/`e`
  - Decrement/Increment player time by one second
- `n`
  - Edit the name of the current marker

## Storage

All the markers are stored in `localStorage` based on the archival VOD, so you won't lose them until you clear this.

## Limitations

If watching a Live stream that is not archiving the stream to a VOD, while you can still add markers, they will be inaccessible after the stream ends as there is no VOD to visit to view them.

## Roadmap

While this contains all the features I desired when creating it, I am open to adding additional features if requested, which you can either do directly or by creating an Issue requesting what feature you desire.
