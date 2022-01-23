import { secondsToDHMS, DHMStoSeconds } from './helpers';
import type { Chapter } from './types';

class ChapterFormatter {
	public static multiline = false;
	static delim: string = '\n';

	static *serialize(_: Chapter[]): Generator<string> {
		return [];
	}
	static *deserialize(_: string): Generator<Chapter> {
		return [];
	}
	static serializeAll(chapters: Chapter[]) {
		return Array.from(this.serialize(chapters)).join(this.delim);
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
	json: class JSONFormatter extends ChapterFormatter {
		static serializeAll(chapters: Chapter[]) {
			return JSON.stringify(chapters);
		}
		static deserializeAll(content: string) {
			return JSON.parse(content);
		}
	},
	minimal: class MinimalFormatter extends ChapterFormatter {
		static delim = '\n';
		static *serialize(chapters: Chapter[]) {
			const places = secondsToDHMS(chapters[chapters.length - 1]?.seconds ?? 0).split(':').length;
			for (const chapter of chapters) {
				const dhms = secondsToDHMS(chapter.seconds, places);
				yield [dhms, chapter.name].join('\t');
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
		(localStorage.getItem('r2_twitch_chapters_ui_formatter') as keyof typeof FORMATTERS) ??
			'minimal'
	];
}
