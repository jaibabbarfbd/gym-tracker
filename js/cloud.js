/* Email accounts and cloud backup with Firebase (Auth + Firestore). The SDK is loaded from Google's
   CDN only when someone uses an account, and only if js/firebase-config.js has the project settings.
   Data layout: users/{uid}/chunks/{name} = { json } (see GymLogic.splitChunks) and
   users/{uid}/sync/meta = { rev, hashes: { chunk name: hash }, at }. */
(function (root) {
  'use strict';
  const CDN = 'https://www.gstatic.com/firebasejs/12.19.0';
  const config = root.GYM_FIREBASE || null;
  const configured = !!(config && config.apiKey && config.projectId);
  let loading = null;

  function load() {
    loading = loading || (async () => {
      const [{ initializeApp }, A, F] = await Promise.all([
        import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore-lite.js`),
      ]);
      const app = initializeApp(config);
      // Email sign-in only, without the popup/redirect helper, so it also works inside the Android app.
      const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
      return { auth, db: F.getFirestore(app), A, F };
    })();
    loading.catch(() => { loading = null; }); // offline: try again next time
    return loading;
  }

  // The signed-in user on this device, once Firebase has checked (null if none).
  async function currentUser() {
    const { auth } = await load();
    await auth.authStateReady();
    return auth.currentUser;
  }

  async function signUp(email, password) {
    const { auth, A } = await load();
    const { user } = await A.createUserWithEmailAndPassword(auth, email, password);
    A.sendEmailVerification(user).catch(() => {});
    return user;
  }

  async function signIn(email, password) {
    const { auth, A } = await load();
    return (await A.signInWithEmailAndPassword(auth, email, password)).user;
  }

  async function signOut() {
    const { auth, A } = await load();
    await A.signOut(auth);
  }

  async function resetPassword(email) {
    const { auth, A } = await load();
    await A.sendPasswordResetEmail(auth, email);
  }

  const metaRef = ({ F, db }, uid) => F.doc(db, 'users', uid, 'sync', 'meta');
  const chunkRef = ({ F, db }, uid, name) => F.doc(db, 'users', uid, 'chunks', name);

  async function getMeta(uid) {
    const fb = await load();
    const snap = await fb.F.getDoc(metaRef(fb, uid));
    return snap.exists() ? snap.data() : { rev: 0, hashes: {} };
  }

  // { name: chunk } for the given chunk names.
  async function getChunks(uid, names) {
    const fb = await load();
    const snaps = await Promise.all(names.map((n) => fb.F.getDoc(chunkRef(fb, uid, n))));
    return Object.fromEntries(names.map((n, i) => [n, snaps[i].exists() ? JSON.parse(snaps[i].data().json) : {}]));
  }

  // Writes the chunks if the account is still at revision `rev`. False if another phone synced first.
  // Chunks are stored as JSON text, which sidesteps Firestore's limits on field names and nested arrays.
  async function commit(uid, rev, chunks, hashes) {
    const fb = await load();
    return fb.F.runTransaction(fb.db, async (tx) => {
      const ref = metaRef(fb, uid);
      const snap = await tx.get(ref);
      const meta = snap.exists() ? snap.data() : { rev: 0, hashes: {} };
      if ((meta.rev || 0) !== rev) return false;
      for (const [name, data] of Object.entries(chunks)) tx.set(chunkRef(fb, uid, name), { json: JSON.stringify(data) });
      tx.set(ref, { rev: rev + 1, hashes: { ...meta.hashes, ...hashes }, at: Date.now() });
      return true;
    });
  }

  // Deletes everything stored for the account, then the account. Asks for the password again first.
  async function deleteAccount(password) {
    const fb = await load();
    const user = fb.auth.currentUser;
    await fb.A.reauthenticateWithCredential(user, fb.A.EmailAuthProvider.credential(user.email, password));
    const meta = await getMeta(user.uid);
    const batch = fb.F.writeBatch(fb.db);
    for (const name of Object.keys(meta.hashes || {})) batch.delete(chunkRef(fb, user.uid, name));
    batch.delete(metaRef(fb, user.uid));
    await batch.commit();
    await fb.A.deleteUser(user);
  }

  const MESSAGES = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/missing-email': 'Enter your email address.',
    'auth/email-already-in-use': 'There\'s already an account with this email. Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with this email. Create one instead.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
    'auth/network-request-failed': 'No internet connection.',
    'auth/user-disabled': 'This account has been turned off.',
    'auth/requires-recent-login': 'Please sign in again first.',
    'permission-denied': 'Your account isn\'t allowed to save here. Sign out and back in.',
    'unavailable': 'No internet connection.',
  };
  function errorText(e) {
    if (MESSAGES[e?.code]) return MESSAGES[e.code];
    if (!navigator.onLine || /Failed to fetch|import|dynamically imported/i.test(e?.message || '')) return 'No internet connection.';
    return `Something went wrong${e?.code ? ` (${e.code})` : ''}. Try again.`;
  }

  root.GymCloud = { configured, currentUser, signUp, signIn, signOut, resetPassword, getMeta, getChunks, commit, deleteAccount, errorText };
})(window);
