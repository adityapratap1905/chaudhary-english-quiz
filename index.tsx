import React, { useState, useEffect} from "react";
import { createRoot } from "react-dom/client";
//import { GoogleGenAI, Type, Schema } from "@google/genai";
import { db } from "./firebase.ts";
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy } from "firebase/firestore";

// --- Types ---

interface Question {
  text: string;
  options: string[];
  correctIndex: number;
}

interface Quiz {
  id: string;
  title: string;
  questions: Question[];
  durationMinutes: number;
  createdAt: number;
}

interface Result {
  id: string;
  quizId: string;
  studentName: string;
  score: number;
  total: number;
  date: number;
}

interface Note {
  id: string;
  title: string;
  description: string;
  fileName: string;
  fileData: string; // Base64
  mimeType: string;
  createdAt: number;
}

type View = "landing" | "teacher-dash" | "teacher-create" | "teacher-notes" | "teacher-leaderboard" | "student-dash" | "student-notes" | "student-quiz" | "student-result";

// --- API & Helper Functions ---

//const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

const generateQuiz = async (
  prompt: string,
  numQuestions: number,
  fileBase64: string | null = null,
  mimeType: string | null = null
): Promise<Quiz | null> => {
  const res = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      numQuestions,
      fileBase64,
      mimeType,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "Quiz generation failed");
  }

  const data = await res.json();

  return {
    id: crypto.randomUUID(),
    title: data.title,
    questions: data.questions,
    durationMinutes: 10,
    createdAt: Date.now(),
  };
};

    // const response = await genAI.models.generateContent({
    //   model: "gemini-3-flash-preview",
    //   contents: { parts },
    //   config: {
    //     systemInstruction: "You are a helpful teacher's assistant designed to create educational quizzes.",
    //     responseMimeType: "application/json",
    //     responseSchema: {
    //       type: Type.OBJECT,
    //       properties: {
    //         title: { type: Type.STRING, description: "A creative title for the quiz" },
    //         questions: {
    //           type: Type.ARRAY,
    //           items: {
    //             type: Type.OBJECT,
    //             properties: {
    //               text: { type: Type.STRING, description: "The question text" },
    //               options: { 
    //                 type: Type.ARRAY, 
    //                 items: { type: Type.STRING },
    //                 description: "4 possible answers"
    //               },
    //               correctIndex: { type: Type.INTEGER, description: "Index of the correct answer (0-3)" }
    //             },
    //             required: ["text", "options", "correctIndex"]
    //           }
    //         }
    //       },
    //       required: ["title", "questions"]
    //     }
    //   }
    // });

//     if (response.text) {
//       const data = JSON.parse(response.text);
//       return {
//         id: crypto.randomUUID(),
//         title: data.title,
//         questions: data.questions,
//         durationMinutes: 10, // Default duration
//         createdAt: Date.now(),
//       };
//     }
//     return null;
//   } catch (error) {
//     console.error("Quiz generation failed:", error);
//     throw error;
//   }
// };

const downloadPDF = (quiz: Quiz) => {
  // @ts-ignore
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text(quiz.title, 20, 20);
  doc.setFontSize(10);
  doc.text(`Time Allowed: ${quiz.durationMinutes || 10} Minutes`, 20, 28);
  
  doc.setFontSize(12);
  let y = 40;
  
  quiz.questions.forEach((q, i) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    
    const questionLines = doc.splitTextToSize(`${i + 1}. ${q.text}`, 170);
    doc.text(questionLines, 20, y);
    y += (questionLines.length * 7);
    
    q.options.forEach((opt, optIndex) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(`   ${String.fromCharCode(65 + optIndex)}. ${opt}`, 20, y);
      y += 6;
    });
    y += 5; // Spacing between questions
  });

  // Add Answer Key on a new page
  doc.addPage();
  doc.setFontSize(16);
  doc.text("Answer Key", 20, 20);
  doc.setFontSize(12);
  y = 40;
  quiz.questions.forEach((q, i) => {
    doc.text(`${i + 1}. ${String.fromCharCode(65 + q.correctIndex)}`, 20, y);
    y += 7;
  });

  doc.save(`${quiz.title.replace(/\s+/g, '_')}_quiz.pdf`);
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const openBase64PDF = (base64Data: string, mimeType: string) => {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
};

const downloadBase64File = (base64Data: string, fileName: string, mimeType: string) => {
  const link = document.createElement("a");
  link.href = `data:${mimeType};base64,${base64Data}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- Components ---

const Button = ({ onClick, children, className = "", variant = "primary", disabled = false }: any) => {
  const base = "px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: any = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-white text-indigo-600 border border-indigo-600 hover:bg-indigo-50",
    danger: "bg-red-500 text-white hover:bg-red-600",
    ghost: "text-gray-600 hover:bg-gray-100"
  };
  return (
    <button onClick={onClick} className={`${base} ${variants[variant]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }: any) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6 ${className}`}>
    {children}
  </div>
);

const App = () => {
  const [view, setView] = useState<View>("landing");
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  
  // Auth State
  const [showAuth, setShowAuth] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Creation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuiz, setGeneratedQuiz] = useState<Quiz | null>(null);
  const [prompt, setPrompt] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Notes Upload State
  const [noteTitle, setNoteTitle] = useState("");
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Student State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [studentName, setStudentName] = useState("");
  const [answers, setAnswers] = useState<number[]>([]);
  const [currentResult, setCurrentResult] = useState<Result | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // Leaderboard State
  const [leaderboardQuiz, setLeaderboardQuiz] = useState<Quiz | null>(null);

  // Firebase Real-time Subscriptions
  useEffect(() => {
    // Subscribe to Quizzes
    const qQuery = query(collection(db, "quizzes"), orderBy("createdAt", "desc"));
    const unsubscribeQuizzes = onSnapshot(qQuery, (snapshot) => {
      const quizzesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Quiz));
      setQuizzes(quizzesData);
    });

    // Subscribe to Notes
    const nQuery = query(collection(db, "notes"), orderBy("createdAt", "desc"));
    const unsubscribeNotes = onSnapshot(nQuery, (snapshot) => {
      const notesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(notesData);
    });

    // Subscribe to Results
    const rQuery = query(collection(db, "results"), orderBy("date", "desc"));
    const unsubscribeResults = onSnapshot(rQuery, (snapshot) => {
      const resultsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Result));
      setResults(resultsData);
    });

    return () => {
      unsubscribeQuizzes();
      unsubscribeNotes();
      unsubscribeResults();
    };
  }, []);

  // Timer Effect
  useEffect(() => {
    if (view === "student-quiz" && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else if (view === "student-quiz" && timeLeft === 0 && activeQuiz) {
      submitQuiz(); // Auto submit when time hits 0
    }
  }, [timeLeft, view]);

  const handleAuth = () => {
    if (authPassword === "admin") {
      setIsAuthenticated(true);
      setView("teacher-dash");
      setShowAuth(false);
      setAuthPassword("");
    } else {
      alert("Incorrect password. Hint: admin");
    }
  };

  const handleCreateQuiz = async () => {
    if (!isAuthenticated) return alert("Unauthorized");
    if (!prompt && !file) {
      setError("Please provide a topic or upload a file.");
      return;
    }
    
    setIsGenerating(true);
    setError(null);

    try {
      let fileBase64 = null;
      let mimeType = null;

      if (file) {
        fileBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // remove data:application/pdf;base64, prefix
          };
          reader.readAsDataURL(file);
        });
        mimeType = file.type;
      }

      const quiz = await generateQuiz(prompt, numQuestions, fileBase64, mimeType);
      if (quiz) {
        setGeneratedQuiz(quiz);
      }
    } catch (e: any) {
      setError("Failed to generate quiz. Please try again. " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUploadNote = async () => {
    if (!isAuthenticated) return alert("Unauthorized");
    if (!noteTitle || !noteFile) {
      setNoteError("Please provide a title and a file.");
      return;
    }

    setNoteError(null);

    try {
      const fileBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); 
        };
        reader.readAsDataURL(noteFile);
      });

      // Add to Firestore
      await addDoc(collection(db, "notes"), {
        title: noteTitle,
        description: "",
        fileName: noteFile.name,
        fileData: fileBase64,
        mimeType: noteFile.type,
        createdAt: Date.now(),
      });

      setNoteTitle("");
      setNoteFile(null);
      alert("Note uploaded successfully!");
    } catch (e: any) {
      setNoteError("Failed to upload note: " + e.message);
    }
  };

  const publishQuiz = async () => {
    if (!isAuthenticated) return alert("Unauthorized");
    if (generatedQuiz) {
      try {
        // Remove the local ID so Firestore generates one
        const { id, ...quizData } = generatedQuiz;
        await addDoc(collection(db, "quizzes"), {
            ...quizData,
            createdAt: Date.now()
        });
        
        setGeneratedQuiz(null);
        setPrompt("");
        setFile(null);
        setNumQuestions(5);
        setView("teacher-dash");
      } catch (e: any) {
        alert("Error publishing quiz: " + e.message);
      }
    }
  };

  const startQuiz = (quiz: Quiz) => {
    if (!studentName.trim()) {
      alert("Please enter your name first!");
      return;
    }
    setActiveQuiz(quiz);
    setAnswers(new Array(quiz.questions.length).fill(-1));
    setTimeLeft((quiz.durationMinutes || 10) * 60); // Default to 10 mins if undefined
    setView("student-quiz");
  };

  const submitQuiz = async () => {
    if (!activeQuiz) return;
    
    let score = 0;
    activeQuiz.questions.forEach((q, i) => {
      if (answers[i] === q.correctIndex) score++;
    });

    const resultData = {
      quizId: activeQuiz.id,
      studentName,
      score,
      total: activeQuiz.questions.length,
      date: Date.now()
    };

    try {
      // Add to Firestore
      const docRef = await addDoc(collection(db, "results"), resultData);
      
      const newResult: Result = { id: docRef.id, ...resultData };
      setCurrentResult(newResult);
      setView("student-result");
    } catch (e: any) {
      alert("Error submitting quiz: " + e.message);
    }
  };

  const getLeaderboard = (quizId: string) => {
    return results
      .filter(r => r.quizId === quizId)
      .sort((a, b) => b.score - a.score);
  };

  const deleteNote = async (noteId: string) => {
    if (!isAuthenticated) return alert("Unauthorized");
    if (confirm("Delete this note?")) {
        try {
            await deleteDoc(doc(db, "notes", noteId));
        } catch (e: any) {
            alert("Error deleting note: " + e.message);
        }
    }
  };

  // --- Views ---

  if (view === "landing") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-4">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Chaudhary English Classes</h1>
        <p className="text-indigo-100 mb-12 text-center max-w-lg">Smart quizzes for better learning – powered by AI.</p>
        
        <div className="grid md:grid-cols-2 gap-6 w-full max-w-2xl relative z-0">
          <button 
            onClick={() => setShowAuth(true)}
            className="group bg-white p-8 rounded-2xl shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-1 text-left"
          >
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Teacher</h2>
            <p className="text-gray-600">Create quizzes, upload PDFs, and track student progress. (Password required)</p>
          </button>

          <button 
            onClick={() => setView("student-dash")}
            className="group bg-white p-8 rounded-2xl shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-1 text-left"
          >
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Student</h2>
            <p className="text-gray-600">Take quizzes online, view scores, and check leaderboards.</p>
          </button>
        </div>

        {showAuth && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">Teacher Login</h3>
                <button onClick={() => setShowAuth(false)} className="text-gray-400 hover:text-gray-600">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">Please enter the password to access teacher features.</p>
              <input 
                type="password" 
                placeholder="Password" 
                className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-gray-900"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              />
              <Button onClick={handleAuth} className="w-full">Access Dashboard</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const Header = ({ title, onBack, rightContent }: any) => (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="text-xl font-bold text-gray-800">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {rightContent}
          <div className="text-sm font-medium text-indigo-600 hidden sm:block">Chaudhary English Classes</div>
        </div>
      </div>
    </header>
  );

  if (view === "teacher-dash") {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Teacher Dashboard" onBack={() => setView("landing")} />
        <main className="max-w-5xl mx-auto p-4 space-y-8">
          
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setView("teacher-notes")}>Manage Notes</Button>
              <Button onClick={() => setView("teacher-create")}>+ Create New Quiz</Button>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Your Quizzes</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {quizzes.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                    No quizzes created yet.
                  </div>
                ) : (
                  quizzes.map(quiz => (
                    <Card key={quiz.id} className="flex flex-col h-full hover:border-indigo-200 transition-colors">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 mb-2">{quiz.title}</h3>
                        <p className="text-sm text-gray-500 mb-1">{quiz.questions.length} questions • {quiz.durationMinutes || 10} mins</p>
                        <p className="text-xs text-gray-400 mb-4">Created {new Date(quiz.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-2">
                        <Button variant="secondary" className="text-sm" onClick={() => downloadPDF(quiz)}>
                          Download PDF
                        </Button>
                        <Button variant="ghost" className="text-sm" onClick={() => {
                          setLeaderboardQuiz(quiz);
                          setView("teacher-leaderboard");
                        }}>
                          Leaderboard
                        </Button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (view === "teacher-notes") {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Manage Study Materials" onBack={() => setView("teacher-dash")} />
        <main className="max-w-3xl mx-auto p-4 space-y-8">
          <Card>
            <h2 className="text-lg font-bold mb-4">Upload New Note</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Note Title</label>
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="e.g., Chapter 1 Summary"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PDF Document</label>
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={(e) => setNoteFile(e.target.files ? e.target.files[0] : null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              {noteError && <p className="text-red-600 text-sm">{noteError}</p>}
              <Button onClick={handleUploadNote}>Upload Note</Button>
              <p className="text-xs text-gray-500 mt-2">Note: Large files may not save. Please keep PDFs under 1MB.</p>
            </div>
          </Card>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Uploaded Materials</h3>
            {notes.length === 0 ? (
               <p className="text-gray-500 text-center py-4">No notes uploaded yet.</p>
            ) : (
              notes.map(note => (
                <Card key={note.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-50 rounded-lg text-red-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900">{note.title}</h4>
                      <p className="text-xs text-gray-500">Uploaded: {new Date(note.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Button variant="danger" className="text-sm" onClick={() => deleteNote(note.id)}>Delete</Button>
                </Card>
              ))
            )}
          </div>
        </main>
      </div>
    );
  }

  if (view === "teacher-create") {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Create Quiz" onBack={() => setView("teacher-dash")} />
        <main className="max-w-3xl mx-auto p-4">
          {!generatedQuiz ? (
            <Card>
              <h2 className="text-xl font-bold mb-6">What is this quiz about?</h2>
              
              <div className="space-y-6">
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Number of Questions</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numQuestions}
                    onChange={(e) => setNumQuestions(parseInt(e.target.value) || 5)}
                    className="w-full md:w-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Topic or Prompt</label>
                  <textarea 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[120px] bg-white text-gray-900"
                    placeholder="e.g. The history of the Roman Empire, or paste an article here..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">OR UPLOAD PDF</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Source Document (PDF)</label>
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                    className="w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-full file:border-0
                      file:text-sm file:font-semibold
                      file:bg-indigo-50 file:text-indigo-700
                      hover:file:bg-indigo-100"
                  />
                  {file && <p className="mt-2 text-sm text-green-600">Selected: {file.name}</p>}
                </div>

                {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

                <Button onClick={handleCreateQuiz} disabled={isGenerating} className="w-full flex justify-center items-center gap-2">
                  {isGenerating ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generating Questions...
                    </>
                  ) : (
                    "Generate Quiz"
                  )}
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <h2 className="text-2xl font-bold">{generatedQuiz.title}</h2>
                <div className="flex gap-2 w-full md:w-auto">
                  <Button variant="secondary" className="flex-1 md:flex-none" onClick={() => setGeneratedQuiz(null)}>Discard</Button>
                  <Button variant="secondary" className="flex-1 md:flex-none" onClick={() => downloadPDF(generatedQuiz)}>Download PDF</Button>
                  <Button className="flex-1 md:flex-none" onClick={publishQuiz}>Publish Online</Button>
                </div>
              </div>
              
              <div className="bg-indigo-50 p-4 rounded-lg flex flex-col md:flex-row gap-4 items-center">
                <div className="flex-1">
                   <label className="block text-sm font-medium text-gray-700 mb-1">Quiz Duration (Minutes)</label>
                   <input
                     type="number"
                     min="1"
                     max="180"
                     value={generatedQuiz.durationMinutes}
                     onChange={(e) => setGeneratedQuiz({...generatedQuiz, durationMinutes: parseInt(e.target.value) || 10})}
                     className="w-full md:w-24 p-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900"
                   />
                </div>
                <div className="text-sm text-gray-500 md:max-w-lg">
                  Set the time limit for students taking this quiz online. Default is 10 minutes.
                </div>
              </div>

              <div className="space-y-4">
                {generatedQuiz.questions.map((q, i) => (
                  <Card key={i} className="relative">
                    <span className="absolute top-4 right-4 text-xs font-mono text-gray-400">#{i + 1}</span>
                    <p className="font-semibold text-lg mb-4 pr-8">{q.text}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {q.options.map((opt, optIdx) => (
                        <div key={optIdx} className={`p-3 rounded-lg border ${optIdx === q.correctIndex ? 'bg-green-50 border-green-200 text-green-800' : 'bg-gray-50 border-gray-100 text-gray-600'}`}>
                          <span className="font-bold mr-2">{String.fromCharCode(65 + optIdx)}.</span>
                          {opt}
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  if (view === "teacher-leaderboard" && leaderboardQuiz) {
    const leaderboard = getLeaderboard(leaderboardQuiz.id);
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title={`Leaderboard: ${leaderboardQuiz.title}`} onBack={() => setView("teacher-dash")} />
        <main className="max-w-3xl mx-auto p-4">
          <Card>
            {leaderboard.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No students have taken this quiz yet.</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-sm">
                    <th className="pb-3 pl-2">Rank</th>
                    <th className="pb-3">Student Name</th>
                    <th className="pb-3">Date</th>
                    <th className="pb-3 text-right pr-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, idx) => (
                    <tr key={idx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="py-3 pl-2 font-mono text-gray-400">#{idx + 1}</td>
                      <td className="py-3 font-medium text-gray-900">{entry.studentName}</td>
                      <td className="py-3 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString()}</td>
                      <td className="py-3 text-right pr-2 font-bold text-indigo-600">
                        {entry.score} / {entry.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </main>
      </div>
    );
  }

  if (view === "student-dash") {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Student Portal" onBack={() => setView("landing")} />
        <main className="max-w-5xl mx-auto p-4">
          <div className="mb-8 bg-white p-6 rounded-xl border border-indigo-100 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-2">Enter Your Name</label>
            <input 
              type="text" 
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="John Doe"
              className="w-full md:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900"
            />
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Available Quizzes</h2>
              <Button variant="secondary" onClick={() => setView("student-notes")}>View Study Materials</Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {quizzes.map(quiz => (
                <Card key={quiz.id} className="hover:shadow-md transition-shadow">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{quiz.title}</h3>
                  <p className="text-sm text-gray-500 mb-2">{quiz.questions.length} questions</p>
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {quiz.durationMinutes || 10} Mins
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => startQuiz(quiz)} className="w-full">Start Quiz</Button>
                  </div>
                </Card>
              ))}
              {quizzes.length === 0 && <p className="text-gray-500">No quizzes available right now.</p>}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (view === "student-notes") {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Study Materials" onBack={() => setView("student-dash")} />
        <main className="max-w-4xl mx-auto p-4 space-y-6">
          <p className="text-gray-600 mb-4">Download or view notes uploaded by your teacher.</p>
          
          <div className="grid gap-4 md:grid-cols-2">
            {notes.length === 0 ? (
               <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                  No study materials available yet.
               </div>
            ) : (
              notes.map(note => (
                <Card key={note.id} className="flex flex-col hover:shadow-md transition-all">
                  <div className="flex items-start gap-4 mb-4">
                     <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                     </div>
                     <div>
                       <h3 className="text-lg font-bold text-gray-900">{note.title}</h3>
                       <p className="text-xs text-gray-500 mt-1">Uploaded: {new Date(note.createdAt).toLocaleDateString()}</p>
                     </div>
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <Button variant="secondary" className="text-sm" onClick={() => openBase64PDF(note.fileData, note.mimeType)}>
                      View Online
                    </Button>
                    <Button className="text-sm" onClick={() => downloadBase64File(note.fileData, note.fileName, note.mimeType)}>
                      Download
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </main>
      </div>
    );
  }

  if (view === "student-quiz" && activeQuiz) {
    const isFinished = answers.every(a => a !== -1);
    const timeIsCritical = timeLeft < 60; // Less than 1 min

    return (
      <div className="min-h-screen bg-gray-50">
        <Header 
          title={activeQuiz.title} 
          onBack={() => {
            if (confirm("Quit quiz? Progress will be lost.")) setView("student-dash");
          }} 
          rightContent={
            <div className={`flex items-center gap-2 font-mono text-lg font-bold ${timeIsCritical ? 'text-red-600 animate-pulse' : 'text-indigo-600'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {formatTime(timeLeft)}
            </div>
          }
        />
        <main className="max-w-3xl mx-auto p-4 space-y-6">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <span>Student: <span className="font-semibold text-gray-900">{studentName}</span></span>
            <span>{answers.filter(a => a !== -1).length} / {activeQuiz.questions.length} Answered</span>
          </div>

          {activeQuiz.questions.map((q, idx) => (
            <Card key={idx} className={answers[idx] !== -1 ? "border-l-4 border-indigo-500" : ""}>
              <div className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-50 text-indigo-600 font-bold text-sm">{idx + 1}</span>
                <div className="flex-1">
                  <p className="text-lg font-medium text-gray-900 mb-4">{q.text}</p>
                  <div className="space-y-2">
                    {q.options.map((opt, optIdx) => (
                      <button
                        key={optIdx}
                        onClick={() => {
                          const newAnswers = [...answers];
                          newAnswers[idx] = optIdx;
                          setAnswers(newAnswers);
                        }}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          answers[idx] === optIdx 
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-md" 
                            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="inline-block w-6 font-bold opacity-70">{String.fromCharCode(65 + optIdx)}.</span>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <div className="sticky bottom-4 bg-white p-4 rounded-xl shadow-xl border border-gray-200 flex justify-between items-center">
             <span className="text-gray-500 text-sm hidden md:inline">Make sure to answer all questions before submitting.</span>
             <Button 
               onClick={submitQuiz} 
               disabled={!isFinished}
               className="w-full md:w-auto"
             >
               Submit Quiz
             </Button>
          </div>
        </main>
      </div>
    );
  }

  if (view === "student-result" && currentResult && activeQuiz) {
    const percentage = Math.round((currentResult.score / currentResult.total) * 100);
    const leaderboard = getLeaderboard(activeQuiz.id);

    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Results" onBack={() => setView("student-dash")} />
        <main className="max-w-3xl mx-auto p-4 space-y-8">
          
          <Card className="text-center py-10">
            <h2 className="text-gray-500 uppercase tracking-wide text-sm font-semibold mb-2">Your Score</h2>
            <div className="text-6xl font-bold text-indigo-600 mb-2">{percentage}%</div>
            <p className="text-xl text-gray-900">You got <span className="font-bold">{currentResult.score}</span> out of {currentResult.total} correct</p>
          </Card>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-gray-900">Review Answers</h3>
              {activeQuiz.questions.map((q, i) => {
                const userAnswer = answers[i];
                const isCorrect = userAnswer === q.correctIndex;
                const isUnanswered = userAnswer === -1;
                
                return (
                  <Card key={i} className={`border-l-4 ${isCorrect ? 'border-green-500' : 'border-red-500'}`}>
                    <p className="font-medium text-gray-900 mb-2">{i+1}. {q.text}</p>
                    <div className="text-sm space-y-1">
                      <p className={isCorrect ? "text-green-700 font-bold" : "text-red-600"}>
                        {isUnanswered ? (
                          <span className="text-gray-500 italic">No Answer Selected</span>
                        ) : (
                          <span className={!isCorrect ? "line-through" : ""}>You: {q.options[userAnswer]}</span>
                        )}
                      </p>
                      {!isCorrect && (
                        <p className="text-green-700 font-bold">
                          Correct: {q.options[q.correctIndex]}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="space-y-6">
              <h3 className="text-xl font-bold text-gray-900">Leaderboard</h3>
              <Card>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="pb-2 text-left">#</th>
                      <th className="pb-2 text-left">Name</th>
                      <th className="pb-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((r, idx) => (
                      <tr key={idx} className={`border-b last:border-0 ${r.id === currentResult.id ? 'bg-indigo-50' : ''}`}>
                        <td className="py-3 text-gray-500">{idx + 1}</td>
                        <td className="py-3 font-medium">{r.studentName} {r.id === currentResult.id && '(You)'}</td>
                        <td className="py-3 text-right font-bold text-indigo-600">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
          
          <div className="flex justify-center">
            <Button onClick={() => setView("student-dash")}>Back to Dashboard</Button>
          </div>
        </main>
      </div>
    );
  }

  return null;
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);