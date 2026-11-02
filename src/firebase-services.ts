import {
  collection, deleteDoc, doc, getDoc, onSnapshot, or, query, runTransaction,
  serverTimestamp, setDoc, where, type DocumentData,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';

export type ContentCollection = 'posts' | 'videos' | 'projects' | 'notes' | 'sections';
export type ContentItem = { id: string; [key: string]: any };
const requireDb = () => { if (!db) throw new Error('Firebase is not configured.'); return db; };

export function watchSiteSettings(next: (value: Record<string, any>) => void, fail: (error: Error) => void) {
  return onSnapshot(doc(requireDb(), 'settings', 'site'), snapshot => next(snapshot.exists() ? snapshot.data() : {}), fail);
}

export async function saveSiteSettings(data: Record<string, any>) {
  const store = requireDb(); const target = doc(store, 'settings', 'site'); const existing = await getDoc(target);
  await setDoc(target, { ...data, ...(existing.exists() ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp() }, { merge: true });
}

export function watchContent<T extends ContentItem>(name: ContentCollection, admin: boolean, next: (items: T[]) => void, fail: (error: Error) => void) {
  const store = requireDb();
  const ref = collection(store, name);
  const constraints = admin ? [] : name === 'sections'
    ? [where('enabled', '==', true)]
    : [or(where('status', '==', 'published'), where('visibility', '==', 'published'))];
  return onSnapshot(query(ref, ...(constraints as any[])), snapshot => {
    const items = snapshot.docs.map(item => {
      const data = item.data();
      const tags = Array.isArray(data.tags) ? data.tags : (typeof data.tags === 'string' ? data.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean) : []);
      const common = { ...data, id: item.id, title: data.title || data.name || data.heading || data.label || 'Untitled', category: data.category || data.topic || 'Uncategorized', tags };
      if (name === 'posts') return { ...common, status: data.status || data.visibility || 'published', excerpt: data.excerpt || data.description || data.summary || '', content: typeof data.content === 'string' ? data.content : (typeof data.body === 'string' ? data.body : (typeof data.html === 'string' ? data.html : '')), cover: data.cover || data.coverImage || '', minutes: Number(data.minutes) || 1 } as unknown as T;
      if (name === 'videos') {
        const youtubeId = data.youtubeId || data.youtubeUrl?.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/)?.[1] || '';
        return { ...common, status: data.status || data.visibility || 'published', description: data.description || data.excerpt || '', youtubeId, thumbnail: data.thumbnail || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : '') } as unknown as T;
      }
      if (name === 'projects') return { ...common, visibility: data.visibility || data.status || 'published', technologies: Array.isArray(data.technologies) ? data.technologies : (Array.isArray(data.techStack) ? data.techStack : (typeof data.technologies === 'string' ? data.technologies.split(',').map((tech: string) => tech.trim()).filter(Boolean) : [])), description: data.description || data.excerpt || '', coverImage: data.coverImage || data.cover || '' } as unknown as T;
      if (name === 'notes') return { ...common, status: data.status || data.visibility || 'published', text: data.text || data.content || '' } as unknown as T;
      return common as unknown as T;
    });
    items.sort((a, b) => name === 'sections' ? Number(a.order || 0) - Number(b.order || 0) : dateValue(b.publishedAt || b.updatedAt) - dateValue(a.publishedAt || a.updatedAt));
    next(items);
  }, fail);
}

function dateValue(value: any) { return value?.toMillis?.() ?? (typeof value === 'number' ? value : Date.parse(value || '') || 0); }

export async function saveContent(name: ContentCollection, id: string | undefined, data: DocumentData) {
  const store = requireDb(); const targetId = id || doc(collection(store, name)).id;
  const existing = id ? await getDoc(doc(store, name, id)) : null;
  const { id: _id, ...fields } = data;
  await setDoc(doc(store, name, targetId), {
    ...fields,
    ...(id && existing?.exists() ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    ...(data.status === 'published' && !data.publishedAt ? { publishedAt: serverTimestamp() } : {}),
  }, { merge: true });
  return targetId;
}

export async function deleteContent(name: ContentCollection, id: string) {
  const store = requireDb();
  if (name !== 'projects') return deleteDoc(doc(store, name, id));
  const projectRef = doc(store, 'projects', id); const pinRegistry = doc(store, 'settings', 'projectPins');
  await runTransaction(store, async tx => {
    const [project, registry] = await Promise.all([tx.get(projectRef), tx.get(pinRegistry)]);
    const ordered: string[] = (registry.data()?.pinnedIds || []).filter((projectId: string) => projectId !== id);
    const refs = ordered.map(projectId => doc(store, 'projects', projectId));
    const snapshots = await Promise.all(refs.map(projectDoc => tx.get(projectDoc)));
    tx.delete(projectRef);
    tx.set(pinRegistry, { pinnedIds: ordered.filter((_, i) => snapshots[i].exists()), updatedAt: serverTimestamp() }, { merge: true });
    snapshots.forEach((snapshot, i) => { if (snapshot.exists()) tx.update(refs[i], { pinOrder: i + 1, updatedAt: serverTimestamp() }); });
    return project.exists();
  });
}

export async function saveProjectWithPinLimit(id: string | undefined, data: DocumentData) {
  const store = requireDb(); const newRef = id ? doc(store, 'projects', id) : doc(collection(store, 'projects')); const pinRegistry = doc(store, 'settings', 'projectPins');
  return runTransaction(store, async tx => {
    const [existing, registry] = await Promise.all([tx.get(newRef), tx.get(pinRegistry)]);
    const pinnedIds: string[] = registry.data()?.pinnedIds || [];
    const isPinned = data.pinned === true;
    const otherIds = pinnedIds.filter(projectId => projectId !== newRef.id);
    const otherRefs = otherIds.map(projectId => doc(store, 'projects', projectId));
    const otherDocs = await Promise.all(otherRefs.map(projectRef => tx.get(projectRef)));
    const orderedOthers = otherDocs.map((snapshot, index) => ({ id: otherIds[index], exists: snapshot.exists(), order: Number(snapshot.data()?.pinOrder) || index + 1 } )).filter(item => item.exists && item.id !== newRef.id).sort((a, b) => a.order - b.order);
    if (isPinned && orderedOthers.length >= 3) throw new Error('You already have three pinned projects. Unpin one before adding another.');
    const nextIds = [...orderedOthers.map(item => item.id)];
    if (isPinned) nextIds.splice(Math.max(0, Math.min(nextIds.length, (Number(data.pinOrder) || nextIds.length + 1) - 1)), 0, newRef.id);
    const pinOrder = isPinned ? nextIds.indexOf(newRef.id) + 1 : null;
    const { id: _id, ...fields } = data;
    tx.set(pinRegistry, { pinnedIds: nextIds, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(newRef, { ...fields, pinOrder, ...(data.visibility === 'published' && !data.publishedAt ? { publishedAt: serverTimestamp() } : {}), ...(existing.exists() ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp() }, { merge: true });
    for (const [index, pinnedId] of nextIds.entries()) {
      if (pinnedId !== newRef.id) tx.update(doc(store, 'projects', pinnedId), { pinOrder: index + 1, updatedAt: serverTimestamp() });
    }
    return newRef.id;
  });
}

export async function uploadMedia(file: File) {
  if (!storage) throw new Error('Firebase Storage is not configured.');
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The image must be smaller than 10 MB.');
  const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `media/${Date.now()}-${clean}`;
  const uploaded = await uploadBytes(ref(storage, path), file, { contentType: file.type });
  const url = await getDownloadURL(uploaded.ref);
  await setDoc(doc(requireDb(), 'media', path.split('/').join('_')), { path, url, name: file.name, contentType: file.type, size: file.size, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { path, url, name: file.name, contentType: file.type, size: file.size };
}
