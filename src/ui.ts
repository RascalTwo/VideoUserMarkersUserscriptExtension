import { NOOP, chToPx, attachEscapeHandler, delay, secondsToDHMS } from './helpers';
import { generateTwitchTimestamp, getButtonClass, getVideoID, isVOD } from './twitch';
import { Chapter } from './types';

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

export const generateChapterList = (
	chapters: Chapter[],
	getCurrentTimeLive: () => Promise<number>,
	handleChapterUpdate: () => Promise<void>,
	setTime: (seconds: number) => Promise<void>,
	startEditingChapter: (
		chapter: Chapter,
		seconds: boolean,
		name: boolean,
		e: Event
	) => Promise<void>,
	seekToChapter: (chapter: Chapter, e: Event) => Promise<void>
) => {
	function deleteChapter(chapter: Chapter) {
		const index = chapters!.findIndex(c => c.seconds === chapter.seconds);
		chapters!.splice(index, 1);
		return handleChapterUpdate();
	}

	function adjustChapterSeconds(chapter: Chapter, change: number) {
		chapter.seconds += change;
		return handleChapterUpdate().then(() => chapter);
	}

	let rendering = false;
	let last = { x: 0, y: 0 };
	const uninstallFuncs: (() => void)[] = [];

	const getCurrentChapterLI = (list: HTMLUListElement) =>
		getCurrentTimeLive().then(
			now =>
				list.querySelectorAll('li')[
					(chapters!
						.map((c, i) => [c, i] as [Chapter, number])
						.filter(([c]) => c.seconds <= now)
						.slice(-1)[0] ?? [null, -1])[1]
				]
		);

	function renderChapterList() {
		if (!rendering) return removeChapterList();

		const existingList = document.querySelector<HTMLUListElement>('.r2_chapter_list');
		const list = existingList || (document.createElement('ul') as HTMLUListElement);
		if (!existingList) {
			list.className = 'r2_chapter_list';
			list.style.position = 'absolute';
			list.style.zIndex = (9000 + getDialogCount()).toString();
			list.style.backgroundColor = '#18181b';
			list.style.padding = '1em';
			list.style.borderRadius = '1em';
			list.style.color = 'white';
			list.style.display = 'flex';
			list.style.flexDirection = 'column';
			list.style.maxHeight = '75vh';
			list.style.maxWidth = '50vw';
			list.style.overflow = 'scroll';
			list.style.resize = 'both';

			list.style.top = last.y + 'px';
			list.style.left = last.x + 'px';

			const header = document.createElement('h4');
			header.textContent = 'Chapter List';
			header.style.backgroundColor = '#08080b';
			header.style.userSelect = 'none';
			header.style.padding = '0';
			header.style.margin = '0';

			let dragging = false;
			header.addEventListener('mousedown', e => {
				dragging = true;
				last = { x: e.clientX, y: e.clientY };
			});
			const handleMouseUp = () => {
				dragging = false;
			};
			document.body.addEventListener('mouseup', handleMouseUp);

			const handleMouseMove = (e: MouseEvent) => {
				if (!dragging) return;

				list.style.top = list.offsetTop - (last.y - e.clientY) + 'px';
				list.style.left = list.offsetLeft - (last.x - e.clientX) + 'px';
				last = { x: e.clientX, y: e.clientY };
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
			closeButton.addEventListener('click', () => setChapterList(false));

			header.appendChild(closeButton);

			uninstallFuncs.push(
				attachEscapeHandler(
					() => setChapterList(false),
					() => list.style.zIndex === (9000 + getDialogCount()).toString()
				)
			);
		}

		chapters!.sort((a, b) => a.seconds - b.seconds);
		const places = secondsToDHMS(chapters![chapters!.length - 1]?.seconds ?? 0).split(':').length;

		function getElementChapter(e: Event) {
			const seconds = Number(
				(e.target! as HTMLElement).closest<HTMLElement>('[data-seconds]')!.dataset.seconds
			);
			return chapters!.find(chapter => chapter.seconds === seconds);
		}

		for (const [i, chapter] of chapters!.entries()) {
			const existingLi = list.querySelectorAll('li')[i];
			const li = existingLi || document.createElement('li');
			li.dataset.seconds = chapter.seconds.toString();
			if (!existingLi) {
				li.style.display = 'flex';
				li.style.alignItems = 'center';
			}

			const timeContent = secondsToDHMS(chapter.seconds, places);

			const time = li.querySelector('span') || document.createElement('span');
			if (!existingLi) {
				time.style.fontFamily = 'monospace';
				time.addEventListener('wheel', e => {
					// Stop native scrolling
					e.preventDefault();

					return adjustChapterSeconds(
						getElementChapter(e)!,
						Math.min(Math.max(e.deltaY, -1), 1)
					).then(chapter => (isVOD() ? setTime(chapter.seconds) : undefined));
				});

				const decrease = document.createElement('button');
				decrease.className = getButtonClass();
				decrease.textContent = '-';
				decrease.title = 'Subtract 1 second';
				decrease.addEventListener('click', e =>
					adjustChapterSeconds(getElementChapter(e)!, -1).then(chapter =>
						isVOD() ? setTime(chapter.seconds) : undefined
					)
				);
				time.appendChild(decrease);

				const timeText = document.createElement('span');
				timeText.textContent = timeContent;
				if (isVOD()) {
					timeText.style.cursor = 'pointer';
					timeText.addEventListener('click', e => seekToChapter(getElementChapter(e)!, e));
				}
				timeText.addEventListener('contextmenu', e =>
					startEditingChapter(getElementChapter(e)!, true, false, e)
				);
				time.appendChild(timeText);

				const increase = document.createElement('button');
				increase.className = getButtonClass();
				increase.textContent = '+';
				increase.title = 'Add 1 second';
				increase.addEventListener('click', e =>
					adjustChapterSeconds(getElementChapter(e)!, 1).then(chapter =>
						isVOD() ? setTime(chapter.seconds) : undefined
					)
				);
				time.appendChild(increase);
				li.appendChild(time);
			} else {
				time.childNodes[1].textContent = timeContent;
			}

			const title =
				li.querySelector<HTMLElement>('span.r2_chapter_title') || document.createElement('span');
			if (!existingLi) {
				title.className = 'r2_chapter_title';
				title.style.flex = '1';
				title.style.textAlign = 'center';
				if (isVOD()) {
					title.style.cursor = 'pointer';
					title.addEventListener('click', e => seekToChapter(getElementChapter(e)!, e));
				}
				title.addEventListener('contextmenu', e =>
					startEditingChapter(getElementChapter(e)!, false, true, e)
				);
				li.appendChild(title);
			}
			title.textContent = chapter.name;

			const share =
				document.querySelector<HTMLButtonElement>('button.r2_chapter_share') ||
				document.createElement('button');
			if (!existingLi) {
				share.className = getButtonClass();
				share.classList.add('r2_chapter_share');
				share.style.float = 'right';
				share.textContent = 'Share';
				share.addEventListener('click', async e => {
					navigator.clipboard.writeText(
						`https://twitch.tv/videos/${await getVideoID(false)}?t=${generateTwitchTimestamp(
							getElementChapter(e)!.seconds
						)}`
					);
				});
				li.appendChild(share);
			}

			const deleteBtn =
				document.querySelector<HTMLButtonElement>('button.r2_chapter_delete') ||
				document.createElement('button');
			if (!existingLi) {
				deleteBtn.className = getButtonClass();
				deleteBtn.classList.add('r2_chapter_delete');
				deleteBtn.style.float = 'right';
				deleteBtn.textContent = 'Delete';
				deleteBtn.addEventListener('click', e => {
					deleteChapter(getElementChapter(e)!);
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
			closeButton.addEventListener('click', () => setChapterList(false));
			list.appendChild(closeButton);

			document.body.appendChild(list);

			delay(0)
				.then(() => getCurrentChapterLI(list))
				.then(li => li?.scrollIntoView());
		}
	}

	function removeChapterList() {
		document.querySelector('.r2_chapter_list')?.remove();
	}

	uninstallFuncs.push(removeChapterList);

	const setChapterList = (render: boolean) => {
		rendering = render;

		changeDialogCount(Number(render));

		renderChapterList();
	};

	const uninstallChapterList = (() => {
		let lastLi: HTMLLIElement | null = null;
		const interval = setInterval(() => {
			const list = document.querySelector<HTMLUListElement>('.r2_chapter_list')!;
			return !list
				? null
				: getCurrentChapterLI(list).then(li => {
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
		removeChapterList,
		renderChapterList,
		setChapterList,
		uninstallChapterList,
	};
};
