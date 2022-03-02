import { NOOP, chToPx, attachEscapeHandler, delay, secondsToDHMS } from './helpers';
import { generateTwitchTimestamp, getButtonClass, getVideoID, isVOD } from './twitch';
import { Marker } from './types';

let openDialogs = 0;

export function getDialogCount() {
	return openDialogs;
}

export function changeDialogCount(change: number) {
	openDialogs += change;
	return openDialogs;
}

/**
 * Show customizable dialog
 *
 * @param {'alert' | 'prompt' | 'choose'} type
 * @param {string} message
 * @param {(form: HTMLFormElement) => any} sideEffect
 */
export async function dialog(
	type: 'alert' | 'prompt' | 'choose',
	message: string,
	sideEffect?: (form: HTMLFormElement) => any
): Promise<any> {
	return new Promise(resolve => {
		openDialogs++;

		let canceled = false;

		const form = document.createElement('form');
		form.style.position = 'absolute';
		form.style.zIndex = (9000 + openDialogs).toString();
		form.style.top = '50%';
		form.style.left = '50%';
		form.style.transform = 'translate(-50%, -50%)';
		form.style.backgroundColor = '#18181b';
		form.style.padding = '1em';
		form.style.borderRadius = '1em';
		form.style.color = 'white';
		form.style.display = 'flex';
		form.style.flexDirection = 'column';
		form.textContent = message;
		const handleSubmit = (e?: Event) => {
			e?.preventDefault();
			const response = canceled ? null : generateResponse(form);
			form.remove();
			openDialogs--;
			removeEscapeHandler();
			return resolve(response);
		};
		form.addEventListener('submit', handleSubmit);

		const [generateResponse, pre, post, afterCreated]: Function[] = {
			alert: () => [
				() => true,
				() => (form.querySelector('button[type="submit"]')! as HTMLElement).focus(),
				NOOP,
				sideEffect!,
			],
			prompt: () => {
				const [type, value] = sideEffect?.(form) ?? ['input', ''];
				const input = document.createElement(type);
				input.value = value;
				if (type === 'textarea') input.setAttribute('rows', 10);

				input.addEventListener('keydown', (e: KeyboardEvent) =>
					e.key === 'Enter' && e.ctrlKey ? handleSubmit() : undefined
				);

				form.appendChild(input);
				return [
					() => input.value.trim(),
					() => input.focus(),
					() => {
						const lines: string[] = input.value.split('\n');
						const longestLine = Math.max(...lines.map(line => line.length));
						if (!longestLine) return;
						input.style.width = Math.max(input.offsetWidth, longestLine * chToPx()) + 'px';
					},
					NOOP,
				];
			},
			choose: () => {
				form.appendChild(
					Object.entries(sideEffect!(form)).reduce((fragment, [key, value]) => {
						const button = document.createElement('button');
						button.className = getButtonClass();
						button.textContent = key;
						button.value = JSON.stringify(value);
						button.addEventListener('click', () => (form.dataset.value = button.value));
						form.dataset.value = JSON.stringify(null);

						fragment.appendChild(button);
						return fragment;
					}, document.createDocumentFragment())
				);
				return [
					() => JSON.parse(form.dataset.value!),
					() => {
						form.querySelector('button[type="submit"]')!.remove();
						form.querySelector('button')!.focus();
					},
					NOOP,
					NOOP,
				];
			},
		}[type]();

		const actions = document.createElement('div');
		actions.style.flex = '1';
		actions.style.display = 'flex';
		const submit = document.createElement('button');
		submit.className = getButtonClass();
		submit.style.flex = '1';
		submit.textContent = 'OK';
		submit.type = 'submit';
		actions.appendChild(submit);

		const cancel = document.createElement('button');
		cancel.className = getButtonClass();
		cancel.style.flex = '1';
		cancel.textContent = 'Cancel';
		cancel.addEventListener('click', () => (canceled = true));
		actions.appendChild(cancel);
		form.appendChild(actions);

		document.body.appendChild(form);
		const removeEscapeHandler = attachEscapeHandler(
			handleSubmit,
			() => form.style.zIndex === (9000 + openDialogs).toString()
		);

		setTimeout(() => {
			pre(form);
			afterCreated?.(form);
			post(form);
		});
	});
}

export const generateMarkerList = (
	markers: Marker[],
	getCurrentTimeLive: () => Promise<number>,
	handleMarkerUpdate: () => Promise<void>,
	setTime: (seconds: number) => Promise<void>,
	startEditingMarker: (marker: Marker, seconds: boolean, name: boolean, e: Event) => Promise<void>,
	seekToMarker: (marker: Marker, e: Event) => Promise<void>
) => {
	function deleteMarker(marker: Marker) {
		const index = markers!.findIndex(m => m.seconds === marker.seconds);
		markers!.splice(index, 1);
		return handleMarkerUpdate();
	}

	function adjustMarkerSeconds(marker: Marker, change: number) {
		marker.seconds += change;
		return handleMarkerUpdate().then(() => marker);
	}

	let rendering = false;
	let last = { x: 0, y: 0, top: window.innerHeight / 10, left: window.innerWidth / 10 };
	const closeFuncs: (() => void)[] = [];
	const uninstallFuncs: (() => void)[] = [];

	function appendMarkerListCSS() {
		if (document.querySelector('.r2_marker_list_style')) return () => undefined;

		const style = document.createElement('style');
		style.className = 'r2_marker_list_style';
		style.appendChild(
			document.createTextNode(`
		/* Scrollbar Styles */
		.r2_marker_list::-webkit-scrollbar {
			width: 7.5px;
		}

		.r2_marker_list::-webkit-scrollbar-track {
			background: transparent;
		}

		.r2_marker_list::-webkit-scrollbar-thumb {
			background-color: rgb(24, 24, 27);
			border-radius: 7px;
			border: 1px solid rgb(239, 239, 241);
		}

		/* Resizing Styles */
		.r2_marker_list::-webkit-resizer {
			border: 3px solid white;
			background: transparent;
			cursor: nwse-resize;
		}
	`)
		);
		document.querySelector('head')!.appendChild(style);
		return () => style.remove();
	}

	const getCurrentMarkerLI = (list: HTMLUListElement) =>
		getCurrentTimeLive().then(
			now =>
				list.querySelectorAll('li')[
					(markers!
						.map((c, i) => [c, i] as [Marker, number])
						.filter(([c]) => Math.floor(c.seconds) <= now)
						.slice(-1)[0] ?? [null, -1])[1]
				]
		);

	function renderMarkerList() {
		if (!rendering) return removeMarkerList();
		uninstallFuncs.push(appendMarkerListCSS());

		const existingList = document.querySelector<HTMLUListElement>('.r2_marker_list');
		const list = existingList || (document.createElement('ul') as HTMLUListElement);
		if (!existingList) {
			const keydownHandler = (e: KeyboardEvent) => {
				const target = e.target! as HTMLElement;
				if (
					['INPUT', 'TEXTAREA'].includes(target.tagName) ||
					target.getAttribute('role') === 'textbox'
				)
					return;

				const { key } = e;
				const active = list.querySelector('li[data-r2_active_marker="true"]');
				if (key === 'w' || key === 's') {
					if (!active) makeActive(list.querySelector('li')!);
					else if (key === 'w' && active.previousElementSibling?.tagName === 'LI')
						makeActive(active.previousElementSibling as HTMLLIElement);
					else if (key === 's' && active.nextElementSibling?.tagName === 'LI')
						makeActive(active.nextElementSibling as HTMLLIElement);
					else {
						return;
					}
					e.preventDefault();
					e.stopPropagation();
				} else if (key === 'a' || key === 'd') {
					if (!active) return;
					e.preventDefault();
					e.stopPropagation();
					return adjustMarkerSeconds(
						getElementMarker({ target: active })!,
						key === 'a' ? -1 : 1
					).then(marker => (isVOD() ? setTime(marker.seconds) : undefined));
				} else if (key === 'n' && active) {
					return startEditingMarker(getElementMarker({ target: active })!, false, true, e);
				} else if (isVOD() && (key === 'q' || key === 'e'))
					getCurrentTimeLive().then(seconds => setTime(seconds + (key === 'q' ? -1 : 1)));
			};
			window.addEventListener('keydown', keydownHandler);
			closeFuncs.push(() => window.removeEventListener('keydown', keydownHandler));

			list.className = 'r2_marker_list';
			list.style.position = 'absolute';
			list.style.zIndex = (9000 + getDialogCount()).toString();
			list.style.backgroundColor = '#18181b';
			list.style.padding = '1em';
			list.style.borderRadius = '1em';
			list.style.color = 'white';
			list.style.display = 'flex';
			list.style.gap = '0.5em';
			list.style.flexDirection = 'column';
			list.style.maxHeight = '75vh';
			list.style.maxWidth = '50vw';
			list.style.overflow = 'scroll';
			list.style.overflowX = 'auto';
			list.style.resize = 'both';

			list.style.top = last.top + 'px';
			list.style.left = last.left + 'px';

			const header = document.createElement('h4');
			header.textContent = 'Marker List';
			header.style.backgroundColor = '#08080b';
			header.style.userSelect = 'none';
			header.style.padding = '0';
			header.style.margin = '0';

			let dragging = false;
			list.addEventListener('mousedown', e => {
				if (
					Math.abs(list.offsetLeft - e.clientX) >= (list.offsetWidth / 10) * 9 &&
					Math.abs(list.offsetTop - e.clientY) >= (list.offsetHeight / 10) * 9
				)
					return;

				dragging = true;
				last.x = e.clientX;
				last.y = e.clientY;
			});
			const handleMouseUp = () => {
				dragging = false;
			};
			document.body.addEventListener('mouseup', handleMouseUp);

			const handleMouseMove = (e: MouseEvent) => {
				if (!dragging) return;

				list.style.top = list.offsetTop - (last.y - e.clientY) + 'px';
				list.style.left = list.offsetLeft - (last.x - e.clientX) + 'px';
				last.x = e.clientX;
				last.y = e.clientY;
				last.top = parseInt(list.style.top);
				last.left = parseInt(list.style.left);
			};
			document.body.addEventListener('mousemove', handleMouseMove);
			list.appendChild(header);

			uninstallFuncs.push(() => {
				document.body.removeEventListener('mousemove', handleMouseMove);
				document.body.removeEventListener('mouseup', handleMouseUp);
			});

			const closeButton = document.createElement('button');
			closeButton.className = getButtonClass();
			closeButton.style.float = 'right';
			closeButton.textContent = 'Close';
			closeButton.addEventListener('click', () => setMarkerList(false));

			header.appendChild(closeButton);

			uninstallFuncs.push(
				attachEscapeHandler(
					() => setMarkerList(false),
					() => list.style.zIndex === (9000 + getDialogCount()).toString()
				)
			);
		}

		markers!.sort((a, b) => a.seconds - b.seconds);
		const places = secondsToDHMS(markers![markers!.length - 1]?.seconds ?? 0).split(':').length;

		function getElementMarker(e: { target: EventTarget | null }) {
			const seconds = Number(
				(e.target! as HTMLElement).closest<HTMLElement>('[data-seconds]')!.dataset.seconds
			);
			return markers!.find(marker => marker.seconds === seconds);
		}

		const makeActive = (li: HTMLLIElement, seekTo: boolean = true) => {
			list.querySelectorAll<HTMLLIElement>('li[data-r2_active_marker="true"]').forEach(otherLi => {
				delete otherLi.dataset.r2_active_marker;
				otherLi.style.backgroundColor = '';
			});
			li.dataset.r2_active_marker = 'true';
			li.style.backgroundColor = 'black';
			li.scrollIntoView();
			if (seekTo && isVOD()) return setTime(getElementMarker({ target: li })!.seconds);
		};

		for (const [i, marker] of markers!.entries()) {
			const existingLi = list.querySelectorAll('li')[i];
			const li = existingLi || document.createElement('li');
			li.dataset.seconds = marker.seconds.toString();
			if (!existingLi) {
				li.style.display = 'flex';
				li.style.gap = '1em';
				li.style.alignItems = 'center';
			}

			const timeContent = secondsToDHMS(marker.seconds, places);

			const time = li.querySelector('span') || document.createElement('span');
			if (!existingLi) {
				time.style.fontFamily = 'monospace';
				time.addEventListener('wheel', e => {
					makeActive(li);
					// Stop native scrolling
					e.preventDefault();

					return adjustMarkerSeconds(
						getElementMarker(e)!,
						Math.min(Math.max(e.deltaY, -1), 1)
					).then(marker => (isVOD() ? setTime(marker.seconds) : undefined));
				});

				const decrease = document.createElement('button');
				decrease.className = getButtonClass();
				decrease.textContent = '-';
				decrease.title = 'Subtract 1 second';
				decrease.addEventListener('click', e => {
					makeActive(li);
					adjustMarkerSeconds(getElementMarker(e)!, -1).then(marker =>
						isVOD() ? setTime(marker.seconds) : undefined
					);
				});
				time.appendChild(decrease);

				const timeText = document.createElement('span');
				timeText.textContent = timeContent;
				if (isVOD()) {
					timeText.style.cursor = 'pointer';
					timeText.addEventListener('click', e => {
						makeActive(li);
						seekToMarker(getElementMarker(e)!, e);
					});
				}
				timeText.addEventListener('contextmenu', e => {
					makeActive(li);

					startEditingMarker(getElementMarker(e)!, true, false, e);
				});
				time.appendChild(timeText);

				const increase = document.createElement('button');
				increase.className = getButtonClass();
				increase.textContent = '+';
				increase.title = 'Add 1 second';
				increase.addEventListener('click', e => {
					makeActive(li);
					adjustMarkerSeconds(getElementMarker(e)!, 1).then(marker =>
						isVOD() ? setTime(marker.seconds) : undefined
					);
				});
				time.appendChild(increase);
				li.appendChild(time);
			} else {
				time.childNodes[1].textContent = timeContent;
			}

			const title =
				li.querySelector<HTMLElement>('span.r2_marker_title') || document.createElement('span');
			if (!existingLi) {
				title.className = 'r2_marker_title';
				title.style.flex = '1';
				title.style.textAlign = 'center';
				if (isVOD()) {
					title.style.cursor = 'pointer';
					title.addEventListener('click', e => {
						makeActive(li);
						seekToMarker(getElementMarker(e)!, e);
					});
				}
				title.addEventListener('contextmenu', e =>
					startEditingMarker(getElementMarker(e)!, false, true, e)
				);
				li.appendChild(title);
			}
			title.textContent = marker.name;

			const share =
				li.querySelector<HTMLButtonElement>('button.r2_marker_share') ||
				document.createElement('button');
			if (!existingLi) {
				share.className = getButtonClass();
				share.classList.add('r2_marker_share');
				share.style.float = 'right';
				share.textContent = 'Share';
				share.addEventListener('click', async e =>
					navigator.clipboard.writeText(
						`https://twitch.tv/videos/${await getVideoID(false)}?t=${generateTwitchTimestamp(
							getElementMarker(e)!.seconds
						)}`
					)
				);
				li.appendChild(share);
			}

			const deleteBtn =
				li.querySelector<HTMLButtonElement>('button.r2_marker_delete') ||
				document.createElement('button');
			if (!existingLi) {
				deleteBtn.className = getButtonClass();
				deleteBtn.classList.add('r2_marker_delete');
				deleteBtn.style.float = 'right';
				deleteBtn.textContent = 'Delete';
				deleteBtn.addEventListener('click', e => {
					deleteMarker(getElementMarker(e)!);
					li.remove();
				});
				li.appendChild(deleteBtn);
			}

			if (!existingLi) list.appendChild(li);
		}

		if (!existingList) {
			const closeButton = document.createElement('button');
			closeButton.className = getButtonClass();
			closeButton.style.float = 'right';
			closeButton.textContent = 'Close';
			closeButton.addEventListener('click', () => setMarkerList(false));
			list.appendChild(closeButton);

			document.body.appendChild(list);

			delay(0)
				.then(() => getCurrentMarkerLI(list))
				.then(li => {
					if (!li) return;
					li.scrollIntoView();
					makeActive(li, false);
				});
		}
	}

	function removeMarkerList() {
		document.querySelector('.r2_marker_list')?.remove();
		closeFuncs.forEach(close => close());
		closeFuncs.splice(0, closeFuncs.length);
	}

	uninstallFuncs.push(removeMarkerList);

	const setMarkerList = (render: boolean) => {
		rendering = render;

		changeDialogCount(Number(render));

		renderMarkerList();
	};

	const uninstallMarkerList = (() => {
		let lastLi: HTMLLIElement | null = null;
		const interval = setInterval(() => {
			const list = document.querySelector<HTMLUListElement>('.r2_marker_list')!;
			return !list
				? null
				: getCurrentMarkerLI(list).then(li => {
						if (!li) return;

						li.style.backgroundColor = 'black';
						if (li === lastLi) return;
						if (lastLi) lastLi.style.backgroundColor = '';
						lastLi = li;
				  });
		}, 1000);

		uninstallFuncs.forEach(func => func());
		return () => clearInterval(interval);
	})();

	return {
		removeMarkerList,
		renderMarkerList,
		setMarkerList,
		uninstallMarkerList,
	};
};
