export interface GameEvent {
  type: 'message' | 'shotResolved' | 'skillUsed' | 'matchOver' | 'draftRequired';
  message?: string;
  shotId?: number;
  seat?: 0 | 1;
}

type Listener = (event: GameEvent) => void;

export class GameEvents {
  private listeners = new Set<Listener>();
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: GameEvent): void { this.listeners.forEach(listener => listener(event)); }
  clear(): void { this.listeners.clear(); }
}
