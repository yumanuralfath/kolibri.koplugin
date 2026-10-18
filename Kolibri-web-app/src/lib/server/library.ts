import { getBooks, getSetting, saveBooks, setSetting } from './database';

export type Highlight = {
	text: string;
	note?: string;
	page?: number;
	createdAt?: string;
};

export type Book = {
	id: string;
	title: string;
	authors: string[];
	series?: string;
	language?: string;
	totalPages: number;
	currentPage: number;
	progress: number;
	status: 'reading' | 'finished' | 'paused';
	startedAt?: string;
	lastReadAt: string;
	finishedAt?: string;
	coverUrl?: string;
	visible: boolean;
	highlights: Highlight[];
};

export type Library = {
	books: Book[];
	published: boolean;
	publishId?: string;
};

export function readLibrary(): Library {
	return {
		books: getBooks().map((book) => JSON.parse(book) as Book),
		published: getSetting('published') === 'true',
		publishId: getSetting('publishId')
	};
}

export function updateLibrary(update: (library: Library) => void | Promise<void>): Library {
	const library = readLibrary();
	const result = update(library);
	if (result instanceof Promise) throw new Error('SQLite library updates must be synchronous.');
	saveBooks(library.books);
	setSetting('published', library.published ? 'true' : 'false');
	if (library.publishId) setSetting('publishId', library.publishId);
	else setSetting('publishId', '');
	return library;
}

export function safeBookId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}
