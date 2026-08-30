type Key = IDBValidKey;

function cmp(a: Key, b: Key): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [a];
    const right = Array.isArray(b) ? b : [b];
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n; i += 1) {
      const c = cmp(left[i] as Key, right[i] as Key);
      if (c !== 0) return c;
    }
    return left.length - right.length;
  }
  if (typeof a !== typeof b) return String(typeof a) < String(typeof b) ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function inRange(key: Key, range: IDBKeyRange | null | undefined) {
  if (!range) return true;
  const lowerOk =
    range.lower === undefined || (range.lowerOpen ? cmp(key, range.lower as Key) > 0 : cmp(key, range.lower as Key) >= 0);
  const upperOk =
    range.upper === undefined || (range.upperOpen ? cmp(key, range.upper as Key) < 0 : cmp(key, range.upper as Key) <= 0);
  return lowerOk && upperOk;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    return current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
  }, value);
}

class MemoryRequest<T> {
  result = undefined as T;
  error: DOMException | null = null;
  onsuccess: ((this: MemoryRequest<T>, ev: Event) => void) | null = null;
  onerror: ((this: MemoryRequest<T>, ev: Event) => void) | null = null;
  source = null;
  transaction = null;
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  constructor(private readonly tx?: MemoryTransaction | null) {
    this.tx?.touch();
  }
  succeed(value: T) {
    this.result = value;
    this.tx?.touch();
    queueMicrotask(() => {
      this.onsuccess?.call(this, new Event("success"));
      this.tx?.touch();
    });
  }
  fail(error: DOMException) {
    this.error = error;
    queueMicrotask(() => {
      this.onerror?.call(this, new Event("error"));
      this.tx?.touch();
    });
  }
}

class MemoryCursor {
  value: unknown;
  constructor(
    public key: Key,
    public primaryKey: Key,
    private readonly rest: Array<{ key: Key; primary: Key; value?: unknown }>,
    private readonly request: MemoryRequest<MemoryCursor | null>
  ) {}
  continue() {
    const next = this.rest.shift();
    if (!next) {
      this.request.succeed(null);
      return;
    }
    const cursor = new MemoryCursor(next.key, next.primary, this.rest, this.request);
    cursor.value = next.value;
    this.request.succeed(cursor);
  }
}

class MemoryIndex {
  constructor(
    private readonly store: MemoryStore,
    private readonly keyPath: string,
    private readonly multiEntry: boolean
  ) {}

  openKeyCursor(range: IDBKeyRange | null = null, direction: IDBCursorDirection = "next") {
    return this.open(range, direction);
  }

  openCursor(range: IDBKeyRange | null = null, direction: IDBCursorDirection = "next") {
    return this.open(range, direction);
  }

  private open(range: IDBKeyRange | null, direction: IDBCursorDirection) {
    const request = new MemoryRequest<MemoryCursor | null>(this.store.tx);
    const rows: Array<{ key: Key; primary: Key; value?: unknown }> = [];
    for (const [encoded, value] of this.store.rows) {
      const raw = readPath(value, this.keyPath);
      const keys = this.multiEntry && Array.isArray(raw) ? raw : [raw];
      for (const key of keys) {
        if (key === undefined) continue;
        if (inRange(key as Key, range)) rows.push({ key: key as Key, primary: this.store.decode(encoded), value });
      }
    }
    rows.sort((a, b) => cmp(a.key, b.key) || cmp(a.primary, b.primary));
    if (direction === "prev") rows.reverse();
    const first = rows.shift();
    if (!first) request.succeed(null);
    else {
      const cursor = new MemoryCursor(first.key, first.primary, rows, request);
      cursor.value = first.value;
      request.succeed(cursor);
    }
    return request;
  }
}

class MemoryStore {
  rows = new Map<string, unknown>();
  indexes = new Map<string, MemoryIndex>();
  tx: MemoryTransaction | null = null;
  constructor(
    public name: string,
    public keyPath?: string
  ) {}

  createIndex(name: string, keyPath: string, options?: IDBIndexParameters) {
    const index = new MemoryIndex(this, keyPath, Boolean(options?.multiEntry));
    this.indexes.set(name, index);
    return index;
  }

  index(name: string) {
    const found = this.indexes.get(name);
    if (!found) throw new Error(`missing index ${name}`);
    return found;
  }

  encode(key: Key) {
    return JSON.stringify(key);
  }

  decode(raw: string) {
    return JSON.parse(raw) as Key;
  }

  private keyOf(value: unknown, explicit?: Key) {
    if (explicit !== undefined) return explicit;
    if (!this.keyPath) throw new Error("key required");
    return readPath(value, this.keyPath) as Key;
  }

  get(key: Key | IDBKeyRange) {
    const request = new MemoryRequest<unknown>(this.tx);
    if (key && typeof key === "object" && "lower" in (key as IDBKeyRange)) {
      const range = key as IDBKeyRange;
      for (const [raw, value] of this.rows) {
        if (inRange(this.decode(raw), range)) {
          request.succeed(structuredClone(value));
          return request;
        }
      }
      request.succeed(undefined);
      return request;
    }
    const encoded = this.encode(key as Key);
    request.succeed(this.rows.has(encoded) ? structuredClone(this.rows.get(encoded)) : undefined);
    return request;
  }

  put(value: unknown, key?: Key) {
    const request = new MemoryRequest<Key>(this.tx);
    const k = this.keyOf(value, key);
    this.rows.set(this.encode(k), structuredClone(value));
    request.succeed(k);
    return request;
  }

  add(value: unknown, key?: Key) {
    const request = new MemoryRequest<Key>(this.tx);
    const k = this.keyOf(value, key);
    if (this.rows.has(this.encode(k))) {
      request.fail(new DOMException("ConstraintError"));
      return request;
    }
    this.rows.set(this.encode(k), structuredClone(value));
    request.succeed(k);
    return request;
  }

  delete(key: Key) {
    const request = new MemoryRequest<undefined>(this.tx);
    this.rows.delete(this.encode(key));
    request.succeed(undefined);
    return request;
  }

  count() {
    const request = new MemoryRequest<number>(this.tx);
    request.succeed(this.rows.size);
    return request;
  }
}

class MemoryTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  private generation = 0;
  constructor(private readonly db: MemoryDatabase) {}
  touch() {
    this.generation += 1;
    const token = this.generation;
    queueMicrotask(() => {
      queueMicrotask(() => {
        if (this.generation === token && !this.aborted) this.oncomplete?.();
      });
    });
  }
  objectStore(name: string) {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`missing store ${name}`);
    store.tx = this;
    return store;
  }
  abort() {
    this.aborted = true;
    this.error = this.error ?? new DOMException("aborted", "AbortError");
    this.onabort?.();
  }
}

class MemoryDatabase {
  stores = new Map<string, MemoryStore>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  constructor(public name: string) {}
  createObjectStore(name: string, options?: IDBObjectStoreParameters) {
    const store = new MemoryStore(name, typeof options?.keyPath === "string" ? options.keyPath : undefined);
    this.stores.set(name, store);
    return store;
  }
  transaction(names: string | string[]) {
    return new MemoryTransaction(this);
  }
  close() {}
}

const databases = new Map<string, MemoryDatabase>();

class MemoryFactory {
  open(name: string, _version?: number) {
    const request = new MemoryRequest<MemoryDatabase>();
    const existing = databases.get(name);
    const db = existing ?? new MemoryDatabase(name);
    if (!existing) {
      databases.set(name, db);
      queueMicrotask(() => {
        const upgrade = (request as MemoryRequest<MemoryDatabase> & { onupgradeneeded?: (ev: Event) => void }).onupgradeneeded;
        if (upgrade) {
          request.result = db;
          upgrade.call(request, new Event("upgradeneeded"));
        }
        request.succeed(db);
      });
      return request;
    }
    request.succeed(db);
    return request;
  }
  deleteDatabase(name: string) {
    const request = new MemoryRequest<undefined>();
    databases.delete(name);
    request.succeed(undefined);
    return request;
  }
}

class MemoryKeyRange {
  constructor(
    public lower?: Key,
    public upper?: Key,
    public lowerOpen = false,
    public upperOpen = false
  ) {}
  static only(value: Key) {
    return new MemoryKeyRange(value, value);
  }
  static bound(lower: Key, upper: Key, lowerOpen = false, upperOpen = false) {
    return new MemoryKeyRange(lower, upper, lowerOpen, upperOpen);
  }
}

export function installMemoryIndexedDB() {
  const host = globalThis as unknown as { indexedDB?: MemoryFactory; IDBKeyRange?: typeof MemoryKeyRange };
  host.indexedDB = new MemoryFactory();
  host.IDBKeyRange = MemoryKeyRange;
}
