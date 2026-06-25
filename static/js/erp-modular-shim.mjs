/** Shim ES module cho app dieuxe — gọi ErpDb (Supabase), không dùng Firebase CDN. */
export const initializeApp = (c, n) => ErpDb.initializeApp(c, n);
export const browserLocalPersistence = 'local';
export const getAuth = () => ErpDb.auth();
export const onAuthStateChanged = (auth, cb) => auth.onAuthStateChanged(cb);
export const signInWithEmailAndPassword = (auth, e, p) => auth.signInWithEmailAndPassword(e, p);
export const setPersistence = () => Promise.resolve();
export const getFirestore = () => ErpDb.firestore();
export const collection = (db, ...s) => { const c = db.collection(s[0]); return s.length === 1 ? c : c.doc(s[1]); };
export const doc = (db, c1, c2, ...r) => db.collection(c1).doc(c2);
export const where = (f, o, v) => ({ type: 'where', field: f, op: o, value: v });
export const orderBy = (f, d) => ({ type: 'orderBy', field: f, dir: d });
export const limit = (n) => ({ type: 'limit', n });
export const query = (colRef, ...cs) => {
  let q = colRef;
  for (const c of cs) {
    if (c.type === 'where') q = q.where(c.field, c.op, c.value);
    if (c.type === 'orderBy') q = q.orderBy(c.field, c.dir);
    if (c.type === 'limit') q = q.limit(c.n);
  }
  return q;
};
export const getDoc = (ref) => ref.get();
export const getDocs = (q) => q.get();
export const addDoc = (col, data) => col.add(data);
export const setDoc = (ref, data, opt) => ref.set(data, opt);
export const updateDoc = (ref, data) => ref.update(data);
export const deleteDoc = (ref) => ref.delete();
export const onSnapshot = (ref, cb, err) => ref.onSnapshot(cb, err);
export const writeBatch = (db) => db.batch();
export const Timestamp = ErpDb.Timestamp;
export const serverTimestamp = () => ErpDb.FieldValue.serverTimestamp();
export const arrayUnion = (...a) => ErpDb.FieldValue.arrayUnion(...a);
export const getFunctions = () => ({});
export const httpsCallable = (_, name) => ErpDb.httpsCallable(name);
