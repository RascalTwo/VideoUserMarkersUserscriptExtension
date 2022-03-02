import { secondsToDHMS, DHMStoSeconds } from './helpers';
import type { Marker } from './types';

class MarkerFormatter {
	public static multiline = false;
	static delim: string = '\n';

	static *serialize(_: Marker[]): Generator<string> {
		return [];
	}
	static *deserialize(_: string): Generator<Marker> {
		return [];
	}
	static serializeAll(markers: Marker[]) {
		return Array.from(this.serialize(markers)).join(this.delim);
	}
	static deserializeAll(content: string) {
		return Array.from(this.deserialize(content));
	}
	static serializeSeconds(seconds: number): any {
		return seconds;
	}
	static deserializeSeconds(serializedSeconds: string): number {
		return Number(serializedSeconds);
	}
	static serializeName(name: string) {
		return name;
	}
	static deserializeName(serializedName: string) {
		return serializedName;
	}
}

export const FORMATTERS = {
	json: class JSONFormatter extends MarkerFormatter {
		static serializeAll(markers: Marker[]) {
			return JSON.stringify(markers);
		}
		static deserializeAll(content: string) {
			return JSON.parse(content);
		}
	},
	minimal: class MinimalFormatter extends MarkerFormatter {
		static delim = '\n';
		static *serialize(markers: Marker[]) {
			const places = secondsToDHMS(markers[markers.length - 1]?.seconds ?? 0).split(':').length;
			for (const marker of markers) {
				const dhms = secondsToDHMS(marker.seconds, places);
				yield [dhms, marker.name].join('\t');
			}
		}
		static *deserialize(content: string) {
			for (const line of content
				.trim()
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean)) {
				const [dhms, ...otherWords] = line.split(/\s/);
				const seconds = DHMStoSeconds(dhms.split(':').map(Number));
				const name = otherWords.join(' ');
				yield { name, seconds };
			}
		}
		static deserializeAll(content: string) {
			return Array.from(this.deserialize(content));
		}
		static serializeSeconds(seconds: number) {
			return secondsToDHMS(seconds);
		}
		static deserializeSeconds(serializedSeconds: string) {
			return DHMStoSeconds(serializedSeconds.split(':').map(Number));
		}
	},
};

export function getUIFormatter() {
	return FORMATTERS[
		(localStorage.getItem('r2_twitch_user_markers_ui_formatter') as keyof typeof FORMATTERS) ??
			'minimal'
	];
}
