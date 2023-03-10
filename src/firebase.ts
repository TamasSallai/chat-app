import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  updateProfile,
  User,
} from 'firebase/auth'
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { v4 as uuid } from 'uuid'
import { ChatDocument, MessageDocument, UserDocument } from './types'

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
export const db = getFirestore(app)
const storage = getStorage(app)

export const loginUser = async (email: string, password: string) => {
  const userCreds = await signInWithEmailAndPassword(auth, email, password)
  const user = userCreds.user
  return user
}

export const registerUser = async (
  username: string,
  email: string,
  password: string,
  profilePicture: File
) => {
  const userCreds = await createUserWithEmailAndPassword(auth, email, password)
  const user = userCreds.user

  const profilePictureRef = ref(storage, email)
  const metadata = { cacheControl: 'public, max-age=43200' }
  await uploadBytes(profilePictureRef, profilePicture, metadata)
  const downloadProfilePictureURL = await getDownloadURL(profilePictureRef)

  await setDoc(doc(db, 'users', user.uid), {
    id: user.uid,
    username,
    email,
    photoURL: downloadProfilePictureURL,
    createdAt: serverTimestamp(),
    chatRefs: [],
  })

  await updateProfile(user, {
    displayName: username,
    photoURL: downloadProfilePictureURL,
  })

  return user
}

export const fetchUsersByUsername = async (uid: string, username: string) => {
  const q = query(collection(db, 'users'), where('username', '==', username))

  try {
    const querySnapshot = await getDocs(q)
    const userDocuments = querySnapshot.docs
      .map((docSnap) => docSnap.data() as UserDocument)
      .filter((data) => data.uid !== uid)

    return userDocuments
  } catch (e) {
    throw new Error()
  }
}

export const createChat = async (
  currentUser: User,
  searchedUser: UserDocument
) => {
  const combinedId =
    currentUser.uid > searchedUser.id
      ? currentUser.uid + searchedUser.id
      : searchedUser.id + currentUser.uid
  const chatRef = doc(db, 'chats', combinedId)

  runTransaction(db, async (transaction) => {
    const chatDoc = await transaction.get(chatRef)
    if (chatDoc.exists()) {
      throw new Error('Document does not exist!')
    }

    transaction.set(chatRef, {
      id: combinedId,
      createdAt: serverTimestamp(),
      members: {
        [currentUser.uid]: {
          id: currentUser.uid,
          username: currentUser.displayName,
          photoURL: currentUser.photoURL,
        },
        [searchedUser.id]: {
          id: searchedUser.id,
          username: searchedUser.username,
          photoURL: searchedUser.photoURL,
        },
      },
    })

    transaction.update(doc(db, 'users', currentUser.uid), {
      chatRefs: arrayUnion(chatRef),
    })

    transaction.update(doc(db, 'users', searchedUser.id), {
      chatRefs: arrayUnion(chatRef),
    })
  })
}

export const fetchChatsByUserId = async (uid: string) => {
  const userRef = doc(db, 'users', uid)

  const chats = await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const userDoc = userSnap.data() as UserDocument
    const chatRefs = userDoc.chatRefs

    const chatSnaps = await Promise.all(
      chatRefs.map((chatRef) => transaction.get(chatRef))
    )

    return chatSnaps
      .filter((chatSnap) => chatSnap.exists())
      .map((chatSnap) => chatSnap.data() as ChatDocument)
  })

  return chats
}

export const createMessage = async (
  chatId: string,
  currentUserId: string,
  content: string
) => {
  const messageId = uuid()
  const message = {
    id: messageId,
    senderId: currentUserId,
    content: content,
    createdAt: serverTimestamp(),
  }
  const messageRef = doc(db, 'chats', chatId, 'messages', messageId)

  const batch = writeBatch(db)
  batch.set(messageRef, message)
  batch.update(doc(db, 'chats', chatId), {
    lastMessage: message,
  })
  await batch.commit()
}

export const fetchMessagesByChatId = async (
  chatId: string,
  queryLimit: number,
  lastMessage: MessageDocument | null = null
) => {
  let q = null

  if (lastMessage) {
    q = query(
      collection(doc(db, 'chats', chatId), 'messages'),
      orderBy('createdAt', 'desc'),
      limit(queryLimit),
      startAfter(lastMessage.createdAt)
    )
  } else {
    q = query(
      collection(doc(db, 'chats', chatId), 'messages'),
      orderBy('createdAt', 'desc'),
      limit(queryLimit)
    )
  }

  const querySnapshot = await getDocs(q)
  const messages = querySnapshot.docs.map(
    (messageSnap) => messageSnap.data() as MessageDocument
  )
  messages.shift()
  return messages
}
