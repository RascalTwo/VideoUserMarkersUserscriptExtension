import { NOOP, chToPx, attachEscapeHandler } from './helpers';
import { getButtonClass } from './twitch';

let openDialogs = 0;

export function getDialogCount() {
	return openDialogs;
}

export function changeDialogCount(change: number){
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
		}, 250);
	});
}
