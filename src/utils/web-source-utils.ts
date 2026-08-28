import { WebSource } from '../services/web-contracts.js';

const MAX_SOURCES = 3;
const MAX_SOURCE_URL_LENGTH = 2048;

const hasControlCharacters = (value: string): boolean => {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x1F || code === 0x7F) {
			return true;
		}
	}
	return false;
};

export function canonicalizeSourceUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || hasControlCharacters(value)) {
			return null;
		}
		url.hash = '';
		const canonical = url.toString();
		return canonical.length <= MAX_SOURCE_URL_LENGTH ? canonical : null;
	} catch {
		return null;
	}
}

export function dedupeWebSources(sources: WebSource[], limit = MAX_SOURCES): WebSource[] {
	const seen = new Set<string>();
	const normalized: WebSource[] = [];
	for (const source of sources) {
		const url = canonicalizeSourceUrl(source.url);
		if (!url || seen.has(url)) {
			continue;
		}
		seen.add(url);
		normalized.push({ ...source, url });
		if (normalized.length >= limit) {
			break;
		}
	}
	return normalized;
}

const safeTitle = (title: string, url: string): string => {
	const withoutControls = [...title].filter(character => !hasControlCharacters(character)).join('');
	const cleaned = withoutControls
		.replaceAll('[', '')
		.replaceAll(']', '')
		.replaceAll('`', '')
		.replaceAll('*', '')
		.replaceAll('_', '')
		.replaceAll('~', '')
		.replaceAll(/\s+/gu, ' ')
		.trim()
		.slice(0, 200);
	if (cleaned) {
		return cleaned;
	}
	try {
		return new URL(url).hostname;
	} catch {
		return 'Source';
	}
};

export function formatWebSources(sources: WebSource[], limit = MAX_SOURCES): string {
	const unique = dedupeWebSources(sources, limit);
	if (unique.length === 0) {
		return '';
	}
	return [
		'**Sources**',
		...unique.map(source => `- [${safeTitle(source.title, source.url)}](<${source.url}>)`),
	].join('\n');
}

const trimWithEllipsis = (value: string, maxLength: number): string => {
	if (value.length <= maxLength) {
		return value;
	}
	if (maxLength <= 1) {
		return '…'.slice(0, maxLength);
	}
	return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

export type ReplyAssembly = {
	modelText: string;
	sources?: WebSource[];
	footer: string;
	maxLength?: number;
};

export function assembleReply({ modelText, sources = [], footer, maxLength = 2000 }: ReplyAssembly): string {
	const cleanText = modelText.trim();
	const cleanFooter = footer.trim();
	let sourceSection = formatWebSources(sources);
	const join = (text: string, sourcesText: string): string => [text, sourcesText, cleanFooter].filter(Boolean).join('\n\n');
	let assembled = join(cleanText, sourceSection);
	if (assembled.length <= maxLength) {
		return assembled;
	}

	const sourceLines = sourceSection.split('\n');
	while (sourceLines.length > 2 && join(cleanText, sourceLines.join('\n')).length > maxLength) {
		sourceLines.splice(-1, 1);
	}
	sourceSection = sourceLines.length > 1 ? sourceLines.join('\n') : '';
	if (sourceSection && join('', sourceSection).length > maxLength) {
		sourceSection = '';
	}
	assembled = join(cleanText, sourceSection);
	if (assembled.length <= maxLength) {
		return assembled;
	}

	const footerLength = cleanFooter ? cleanFooter.length + 2 : 0;
	const sourceLength = sourceSection ? sourceSection.length + 2 : 0;
	const textBudget = Math.max(0, maxLength - footerLength - sourceLength);
	return join(trimWithEllipsis(cleanText, textBudget), sourceSection).slice(0, maxLength);
}
