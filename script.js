/**
 * Get X and Y of the seconds provided
 *
 * @param {number} seconds
 * @returns {{ x: number, y: number }}
 */
function getTimeXY(seconds) {
	const bar = document.querySelector('[data-a-target="player-seekbar"]');

	const rect = bar.getBoundingClientRect();
	const minX = rect.left;
	const maxX = rect.right;

	const duration = Number(document.querySelector('[data-a-target="player-seekbar-duration"]').dataset.aValue);
	const percentage = seconds / duration;
	const x = ((maxX - minX) * percentage) + minX;
	const y = (rect.bottom + rect.top) / 2
	return { x, y }
}

/**
 * Set time to the seconds provided
 *
 * @param {number} seconds
 */
function setTime(seconds) {
	const bar = document.querySelector('[data-a-target="player-seekbar"]');

	const event = new MouseEvent('click', { clientX: getTimeXY(seconds).x });
	// Directly hook into onClick of react element, bar.dispatchEvent(event) did NOT work
	Object.entries(bar).find(([key]) => key.startsWith('__reactEventHandlers'))[1].onClick(event);
}



/**
 * Convert DHMS to seconds, each part is optional except seconds
 *
 * @param {number[]} parts DHMS numberic parts
 * @returns {number} seconds
 */
function DHMStoSeconds(parts) {
	if (parts.length === 1) return parts[0];
	else if (parts.length === 2) return (parts[0] * 60) + parts[1]
	else if (parts.length === 3) return (parts[0] * 60 * 60) + (parts[1] * 60) + parts[2]
	return (parts[0] * 60 * 60 * 24) + (parts[1] * 60 * 60) + (parts[2] * 60) + parts[3]
}

/**
 * Parse from Minimal to Chapter objects
 *
 * @param {string} text
 * @yields {{ name: string, seconds: number }}
 */
function* parseMinimalChapters(text) {
	for (const line of text.trim().split('\n').map(line => line.trim()).filter(Boolean)) {
		const [dhms, name] = line.split('\t');
		const seconds = DHMStoSeconds(dhms.split(':').map(Number).filter(Boolean));
		yield { name, seconds }
	}
}

/**
 * Convert seconds to DHMS
 *
 * @param {number} seconds
 * @returns {string}
 */
function secondsToDHMS(seconds) {
	// TODO - fix this rushed math
	const days = parseInt(seconds / 86400)
	const hours = parseInt((seconds - (days * 86400)) / 3600)
	const minutes = parseInt((seconds % (60 * 60)) / 60)
	return [days, hours, minutes, seconds % 60].filter(Boolean).join(':')
}

/**
 * Convert chapters to Minimal text
 *
 * @param {{ name: string, seconds: number }[]} chapters
 */
function* chaptersToMinimal(chapters) {
	for (const chapter of chapters.sort((a, b) => a.seconds - b.seconds)) {
		const dhms = secondsToDHMS(chapter.seconds)
		yield [dhms, chapter.name].join('\t');
	}
}

// Run cleanup if previously loaded, development only
window.r2?.cleanup?.()
r2 = (() => {
	// Get last segment of URL, which is the video ID
	const VID = window.location.href.split('/').slice(-1)[0].split('?')[0];
	const chapters = JSON.parse(localStorage.getItem('r2_chapters_' + VID) ?? '[]');

	/**
	 * Remove chapter DOM elements, done before rendering and cleanup
	 */
	const removeDOMChapters = () => {
		document.querySelectorAll('.r2_chapter').forEach(e => e.remove());
	}

	/**
	 * Handle when marker is directly clicked
	 *
	 * @param {{ name: string, seconds: number}} chapter
	 * @param {MouseEvent} e
	 */
	const handleMarkerClick = (chapter, e) => {
		setTime(chapter.seconds)
	}

	/**
	 * Render all chapters
	 */
	const renderChapters = () => {
		removeDOMChapters();
		for (const [i, chapter] of chapters.entries()) {
			const node = document.createElement('button')
			node.className = 'r2_chapter'
			node.title = chapter.name;
			node.style.position = 'absolute';
			const { x, y } = getTimeXY(chapter.seconds)
			node.style.top = y + 'px';
			// TODO - properly position element in center of where it should be
			node.style.left = (x - 2.5) + 'px';
			node.style.zIndex = 1;
			node.textContent = i
			node.addEventListener('click', handleMarkerClick.bind(null, chapter))
			document.body.appendChild(node);
		}
		localStorage.setItem('r2_chapters_' + VID, JSON.stringify(chapters))
	}

	/**
	 * Add chapter to current time
	 */
	const addChapterHere = () => {
		const seconds = DHMStoSeconds(document.querySelector('[data-a-target="player-seekbar-current-time"]').textContent.split(':').map(Number));
		const name = prompt('Name');
		if (!name) return;

		chapters.push({ seconds, name });
		renderChapters();
	}


	/**
	 * Import minimal chapter text
	 */
	async function importMinimal() {
		const markdown = await navigator.clipboard.readText()
		chapters.splice(0, chapters.length, ...Array.from(parseMinimalChapters(markdown)));
		renderChapters();
	}


	/**
	 * Export chapter objects into minimal chapters
	 */
	const exportMarkdown = () => {
		navigator.clipboard.writeText(Array.from(chaptersToMinimal(chapters)).join('\n'));
		alert('Exported to Clipboard!');
	}

	/**
	 * Menu for importing or exporting
	 */
	const menu = () => {
		const choice = prompt('(I)mport or (E)xport')
		if (!choice) return;
		if (choice.toLowerCase() === 'i') importMinimal()
		else if (choice.toLowerCase() === 'e') exportMarkdown();
	}

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keydownHandler = e => {
		if (e.key === 'c') menu()
		if (e.key === 'b') addChapterHere()
	};
	window.addEventListener('keydown', keydownHandler);

	let renderTimeout = 0;
	/**
	 * Handle window resizing
	 */
	const resizeHandler = () => {
		clearTimeout(renderTimeout);
		renderTimeout = setTimeout(renderChapters, 1000);
	};
	window.addEventListener('resize', resizeHandler);

	function cleanup() {
		window.removeEventListener('keydown', keydownHandler);
		window.removeEventListener('resize', resizeHandler);
		removeDOMChapters();
	}

	if (chapters.length) renderChapters();

	return { chapters, cleanup };
})();