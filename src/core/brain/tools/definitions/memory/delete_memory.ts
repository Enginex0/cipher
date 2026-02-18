import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';

export const deleteMemoryTool: InternalTool = {
	name: 'memory_delete',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Delete one or more knowledge memory entries by ID. Use cipher_memory_search first to find IDs, then pass them here for permanent deletion.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			ids: {
				type: 'array',
				items: {
					oneOf: [{ type: 'string' }, { type: 'number' }],
				},
				description: 'Array of memory entry IDs to delete. Get IDs from cipher_memory_search results.',
				minItems: 1,
				maxItems: 100,
			},
		},
		required: ['ids'],
	},
	handler: async (args: any, context?: InternalToolContext) => {
		const startTime = Date.now();

		if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
			return {
				success: false,
				error: 'ids must be a non-empty array',
				deleted: 0,
				failed: 0,
				timestamp: new Date().toISOString(),
			};
		}

		if (!context?.services) {
			return {
				success: false,
				error: 'No services context available',
				deleted: 0,
				failed: 0,
				timestamp: new Date().toISOString(),
			};
		}

		const vectorStoreManager = context.services.vectorStoreManager;
		if (!vectorStoreManager) {
			return {
				success: false,
				error: 'VectorStoreManager not available',
				deleted: 0,
				failed: 0,
				timestamp: new Date().toISOString(),
			};
		}

		let vectorStore;
		try {
			vectorStore =
				(vectorStoreManager as any).getStore('knowledge') || vectorStoreManager.getStore();
		} catch {
			try {
				vectorStore = vectorStoreManager.getStore();
			} catch (e) {
				return {
					success: false,
					error: `Failed to get vector store: ${e instanceof Error ? e.message : String(e)}`,
					deleted: 0,
					failed: 0,
					timestamp: new Date().toISOString(),
				};
			}
		}

		let deleted = 0;
		let failed = 0;
		const errors: Array<{ id: string | number; error: string }> = [];

		for (const id of args.ids) {
			try {
				const numericId = typeof id === 'string' ? Number(id) : id;
				if (isNaN(numericId)) {
					errors.push({ id, error: 'Invalid ID: not a number' });
					failed++;
					continue;
				}

				await vectorStore.delete(numericId);
				deleted++;
				logger.debug('MemoryDelete: entry deleted', { id: numericId });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				errors.push({ id, error: msg });
				failed++;
				logger.warn('MemoryDelete: failed to delete entry', { id, error: msg });
			}
		}

		const totalTime = Date.now() - startTime;

		logger.info('MemoryDelete: operation complete', {
			requested: args.ids.length,
			deleted,
			failed,
			totalTime: `${totalTime}ms`,
		});

		return {
			success: failed === 0,
			deleted,
			failed,
			errors: errors.length > 0 ? errors : undefined,
			totalTime,
			timestamp: new Date().toISOString(),
		};
	},
};
