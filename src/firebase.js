import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyAQ0Tz1t6SQjxqFhBJXbOTaLSqS8IhxWdI",
    authDomain: "bucket-badge.firebaseapp.com",
    databaseURL: "https://bucket-badge.firebaseio.com",
    projectId: "bucket-badge",
    storageBucket: "bucket-badge.appspot.com",
    messagingSenderId: "365671492555",
    appId: "1:365671492555:web:b2c5d8e6b02a7c0415644e",
    measurementId: "G-Y0WQ8C6CPJ"
};

firebase.initializeApp(firebaseConfig);

export const db = firebase.firestore();

export const auth = firebase.auth();
export const googleProvider = new firebase.auth.GoogleAuthProvider();