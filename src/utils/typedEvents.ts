import { EventEmitter } from 'events';

/**
 * Type-safe event emitter. Provides compile-time checking on event names
 * and payloads via a type map interface.
 *
 * Usage:
 *   interface MyEvents {
 *       data: { value: number };
 *       error: { message: string };
 *   }
 *   class MyEmitter extends TypedEventEmitter<MyEvents> { ... }
 *   emitter.emit('data', { value: 42 });      // ✅
 *   emitter.emit('data', { wrong: true });     // ❌ compile error
 *   emitter.on('event', (e) => { e.data... }); // autocomplete on e.data
 */

/** Discriminated union for wrapped events */
export interface WrappedEvent<K extends string, D> {
    type: K;
    data: D;
}

/**
 * Map from event name to payload shape.
 * Pi Agent uses a single 'event' channel with discriminated union.
 */
export interface AgentEventMap {
    userMessage: { content: string };
    assistantMessage: { content: string; agent?: string };
    toolCall: { id?: string; name: string; arguments: any };
    toolResult: { id?: string; name: string; content: string; isError?: boolean };
    streamStart: {};
    streamChunk: { content: string };
    streamEnd: {};
    error: { message: string };
    clear: {};
    status: { status: 'thinking' | 'streaming' | 'executing' | 'compacting' | 'idle'; agent?: string };
    compaction: { summary: string; droppedCount: number };
}

export type AgentEvent = keyof AgentEventMap;
export type AgentEventData<K extends AgentEvent = AgentEvent> = WrappedEvent<K, AgentEventMap[K]>;

/**
 * Typed event emitter with compile-time checking.
 * Extends Node.js EventEmitter with type-safe emit/on/once.
 */
export class TypedEventEmitter<Events extends Record<string, any>> extends EventEmitter {
    emit<K extends keyof Events & string>(event: K, data: Events[K]): boolean {
        return super.emit(event, data);
    }

    on<K extends keyof Events & string>(event: K, listener: (data: Events[K]) => void): this {
        return super.on(event, listener);
    }

    once<K extends keyof Events & string>(event: K, listener: (data: Events[K]) => void): this {
        return super.once(event, listener);
    }

    off<K extends keyof Events & string>(event: K, listener: (data: Events[K]) => void): this {
        return super.off(event, listener);
    }

    removeListener<K extends keyof Events & string>(event: K, listener: (data: Events[K]) => void): this {
        return super.removeListener(event, listener);
    }
}
