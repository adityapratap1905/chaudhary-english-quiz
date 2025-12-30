import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./firebase.ts";
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, updateDoc, increment } from "firebase/firestore";

// --- Types ---

type Difficulty = "Easy" | "Medium" | "Hard";

interface Question {
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface Quiz {
  id: string;
  title: string;
  subject?: string;
  difficulty: Difficulty;
  questions: Question[];
  durationMinutes: number;
  starts?: number;
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

type ToastType = "success" | "error" | "info";

// --- API & Helper Functions ---

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

const generateQuiz = async (prompt: string, numQuestions: number, difficulty: Difficulty, fileBase64: string | null = null, mimeType: string | null = null): Promise<Quiz | null> => {
  try {
    const parts: any[] = [];
    const difficultyPrompt = `The difficulty level must be ${difficulty}.`;
    
    if (fileBase64 && mimeType) {
      parts.push({
        inlineData: {
          data: fileBase64,
          mimeType: mimeType,
        },
      });
      parts.push({
        text: `Generate a quiz based on this document. Create exactly ${numQuestions} multiple choice questions. ${difficultyPrompt}`,
      });
    } else {
      parts.push({
        text: `Generate a quiz based on the following topic/content: "${prompt}". Create exactly ${numQuestions} multiple choice questions. ${difficultyPrompt}`,
      });
    }

    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        systemInstruction: "You are an expert educator designed to create high-quality quizzes. For EVERY question, you MUST provide a clear, concise 'explanation' that describes exactly why the correct answer is right. This explanation is critical for student learning.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A creative title for the quiz" },
            subject: { type: Type.STRING, description: "The academic subject (e.g. Mathematics, History, Science)" },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: "The question text" },
                  options: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "4 possible answers"
                  },
                  correctIndex: { type: Type.INTEGER, description: "Index of the correct answer (0-3)" },
                  explanation: { type: Type.STRING, description: "A helpful explanation of why the correct answer is the right choice." }
                },
                required: ["text", "options", "correctIndex", "explanation"]
              }
            }
          },
          required: ["title", "subject", "questions"]
        }
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return {
        id: crypto.randomUUID(),
        title: data.title,
        subject: data.subject || "General",
        difficulty: difficulty,
        questions: data.questions,
        durationMinutes: 10, // Default duration
        createdAt: Date.now(),
      };
    }
    return null;
  } catch (error) {
    console.error("Quiz generation failed:", error);
    throw error;
  }
};

const downloadPDF = (quiz: Quiz) => {
  // @ts-ignore
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text(quiz.title, 20, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Subject: ${quiz.subject || 'General'} | Level: ${quiz.difficulty}`, 20, 26);
  doc.text(`Time Allowed: ${quiz.durationMinutes || 10} Minutes`, 20, 32);
  
  doc.setLineWidth(0.5);
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 36, 190, 36);

  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  let y = 45;
  
  quiz.questions.forEach((q, i) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    
    doc.setFont("helvetica", "bold");
    const questionLines = doc.splitTextToSize(`${i + 1}. ${q.text}`, 170);
    doc.text(questionLines, 20, y);
    y += (questionLines.length * 6);
    doc.setFont("helvetica", "normal");
    
    q.options.forEach((opt, optIndex) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(`   ${String.fromCharCode(65 + optIndex)}. ${opt}`, 20, y);
      y += 6;
    });
    y += 6; // Spacing between questions
  });

  // Add Answer Key with Explanations
  doc.addPage();
  doc.setFontSize(18);
  doc.text("Answer Key & Explanations", 20, 20);
  doc.setFontSize(11);
  y = 40;
  
  quiz.questions.forEach((q, i) => {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(79, 70, 229); // Indigo
    doc.text(`${i + 1}. Correct: ${String.fromCharCode(65 + q.correctIndex)}`, 20, y);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    
    if (q.explanation) {
        y += 5;
        const explanationLines = doc.splitTextToSize(`${q.explanation}`, 160);
        doc.text(explanationLines, 25, y);
        y += (explanationLines.length * 5) + 8;
    } else {
        y += 10;
    }
  });

  doc.save(`${quiz.title.replace(/\s+/g, '_')}_quiz.pdf`);
};

const downloadCertificate = (studentName: string, quizTitle: string, score: number, total: number) => {
  // @ts-ignore
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("landscape");
  
  // Background & Border
  doc.setFillColor(250, 250, 255);
  doc.rect(0, 0, 297, 210, 'F');
  
  doc.setLineWidth(2);
  doc.setDrawColor(79, 70, 229); // Indigo 600
  doc.rect(10, 10, 277, 190);
  
  doc.setLineWidth(0.5);
  doc.setDrawColor(200, 200, 200);
  doc.rect(15, 15, 267, 180);

  // Decorative Elements
  doc.setFillColor(79, 70, 229);
  doc.circle(20, 20, 4, 'F');
  doc.circle(277, 20, 4, 'F');
  doc.circle(20, 190, 4, 'F');
  doc.circle(277, 190, 4, 'F');

  // Content
  doc.setFont("helvetica", "bold");
  doc.setFontSize(42);
  doc.setTextColor(79, 70, 229);
  doc.text("CERTIFICATE", 148.5, 50, { align: "center" });
  doc.setFontSize(16);
  doc.setTextColor(120, 120, 120);
  doc.text("OF ACHIEVEMENT", 148.5, 60, { align: "center" });
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(18);
  doc.setTextColor(60, 60, 60);
  doc.text("This certificate is proudly presented to", 148.5, 85, { align: "center" });
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(30, 30, 30);
  doc.text(studentName, 148.5, 105, { align: "center" });
  
  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(1);
  doc.line(70, 108, 227, 108);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(18);
  doc.setTextColor(60, 60, 60);
  doc.text("For outstanding performance in", 148.5, 125, { align: "center" });
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(quizTitle, 148.5, 138, { align: "center" });
  
  const percentage = Math.round((score/total)*100);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(79, 70, 229);
  doc.setFontSize(20);
  doc.text(`Score: ${percentage}%`, 148.5, 155, { align: "center" });
  
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.setFont("helvetica", "normal");
  const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(`Awarded on ${dateStr}`, 148.5, 175, { align: "center" });
  doc.text("Chaudhary English Classes", 148.5, 182, { align: "center" });

  doc.save(`${studentName}_certificate.pdf`);
};

const downloadDetailedReport = (studentName: string, quiz: Quiz, answers: number[], score: number, total: number) => {
  // @ts-ignore
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text("Student Scorecard", 20, 20);
  doc.setFontSize(12);
  doc.text("Chaudhary English Classes", 20, 30);
  
  // Info Section
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.text(`Student: ${studentName}`, 20, 55);
  doc.text(`Quiz: ${quiz.title}`, 20, 62);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 55);
  
  const pct = Math.round((score/total)*100);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(pct >= 80 ? 22 : 79, pct >= 80 ? 163 : 70, pct >= 80 ? 74 : 229);
  doc.text(`Final Score: ${score}/${total} (${pct}%)`, 150, 65);
  
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(20, 70, 190, 70);

  let y = 85;
  doc.setFontSize(11);

  quiz.questions.forEach((q, i) => {
    const userAnswerIndex = answers[i];
    const isCorrect = userAnswerIndex === q.correctIndex;
    const isSkipped = userAnswerIndex === -1;

    // Page break check
    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    // Question
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    const qLines = doc.splitTextToSize(`${i + 1}. ${q.text}`, 170);
    doc.text(qLines, 20, y);
    y += (qLines.length * 5) + 3;

    // User Answer
    doc.setFont("helvetica", "normal");
    const userAnsText = isSkipped ? "(Skipped)" : q.options[userAnswerIndex];
    
    if (isCorrect) {
      doc.setTextColor(22, 163, 74); // Green
      doc.text(`✔ Your Answer: ${userAnsText}`, 25, y);
    } else {
      doc.setTextColor(220, 38, 38); // Red
      doc.text(`✘ Your Answer: ${userAnsText}`, 25, y);
      y += 6;
      doc.setTextColor(22, 163, 74); // Green
      doc.text(`✔ Correct Answer: ${q.options[q.correctIndex]}`, 25, y);
    }
    doc.setTextColor(0, 0, 0); // Reset black
    y += 8;

    // Explanation
    if (q.explanation) {
       doc.setFontSize(10);
       doc.setTextColor(80, 80, 80);
       const explLines = doc.splitTextToSize(`💡 ${q.explanation}`, 160);
       
       // Calculate background height
       const bgHeight = (explLines.length * 5) + 6;
       
       doc.setFillColor(243, 244, 246);
       doc.rect(25, y - 4, 165, bgHeight, 'F');
       
       doc.text(explLines, 25, y);
       y += bgHeight + 8;
       doc.setFontSize(11);
       doc.setTextColor(0, 0, 0);
    } else {
        y += 4;
    }
  });

  doc.save(`${studentName}_scorecard.pdf`);
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

// --- Gamification Helpers ---

const calculateStreak = (studentName: string, allResults: Result[]) => {
    if (!studentName) return 0;
    const myResults = allResults.filter(r => r.studentName.toLowerCase() === studentName.toLowerCase());
    
    const dates = Array.from(new Set(myResults.map(r => {
        const d = new Date(r.date);
        d.setHours(0,0,0,0);
        return d.getTime();
    }))).sort((a,b) => b - a);

    if (dates.length === 0) return 0;

    let streak = 1;
    let currentDate = dates[0];
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (currentDate !== today.getTime() && currentDate !== yesterday.getTime()) {
        return 0;
    }

    for (let i = 0; i < dates.length - 1; i++) {
        const current = new Date(dates[i]);
        const next = new Date(dates[i+1]);
        const diffTime = Math.abs(current.getTime() - next.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        if (diffDays === 1) streak++;
        else break;
    }
    return streak;
};

const hasGrammarMaster = (studentName: string, allResults: Result[]) => {
    return allResults.some(r => r.studentName.toLowerCase() === studentName.toLowerCase() && r.score === r.total);
};

const isTop3 = (studentName: string, quizId: string, allResults: Result[]) => {
    const quizResults = allResults.filter(r => r.quizId === quizId);
    quizResults.sort((a, b) => a.date - b.date);
    
    const uniqueResults: Result[] = [];
    const seen = new Set<string>();
    quizResults.forEach(r => {
        const key = `${r.studentName.trim().toLowerCase()}-${r.score}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueResults.push(r);
        }
    });
    
    const sorted = uniqueResults.sort((a, b) => b.score - a.score);
    const index = sorted.findIndex(r => r.studentName.toLowerCase() === studentName.toLowerCase());
    return index !== -1 && index < 3;
};

// --- Components ---

const Toast = ({ message, type, onClose }: { message: string, type: ToastType, onClose: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const bgColors = {
        success: "bg-green-600",
        error: "bg-red-600",
        info: "bg-gray-800"
    };

    return (
        <div className={`fixed bottom-5 right-5 ${bgColors[type]} text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 z-50 animate-fade-in-up transition-all`}>
            {type === 'success' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>}
            {type === 'error' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>}
            <span className="font-medium">{message}</span>
        </div>
    );
};

const Button = ({ onClick, children, className = "", variant = "primary", disabled = false, fullWidth = false }: any) => {
  const base = "px-5 py-2.5 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95";
  const variants: any = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg",
    secondary: "bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300 shadow-sm",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100",
    warning: "bg-amber-500 text-white hover:bg-amber-600 shadow-md",
    ghost: "text-slate-600 hover:bg-slate-100"
  };
  return (
    <button onClick={onClick} className={`${base} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "", hover = false }: any) => (
  <div className={`bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-slate-100 p-6 ${hover ? 'hover:shadow-md hover:border-indigo-100 transition-all duration-300' : ''} ${className}`}>
    {children}
  </div>
);

const Badge = ({ icon, title, active, description }: any) => (
    <div className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 ${active ? 'bg-gradient-to-br from-yellow-50 to-orange-50 border-orange-100 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-inner ${active ? 'bg-white text-yellow-600' : 'bg-slate-200 grayscale'}`}>
            {icon}
        </div>
        <div className="flex-1">
            <h4 className={`font-bold text-base ${active ? 'text-slate-800' : 'text-slate-500'}`}>{title}</h4>
            <p className="text-sm text-slate-500 mt-1 leading-snug">{description}</p>
        </div>
        {active && (
            <div className="text-orange-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </div>
        )}
    </div>
);

const StatCard = ({ title, value, icon, color }: any) => (
    <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
        <div className={`p-3 rounded-lg ${color} text-white shadow-md`}>{icon}</div>
        <div>
            <p className="text-slate-500 text-sm font-medium">{title}</p>
            <p className="text-2xl font-bold text-slate-800">{value}</p>
        </div>
    </div>
);

const App = () => {
  const [view, setView] = useState<View>("landing");
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [toast, setToast] = useState<{message: string, type: ToastType} | null>(null);

  // Auth State
  const [showAuth, setShowAuth] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Creation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuiz, setGeneratedQuiz] = useState<Quiz | null>(null);
  const [prompt, setPrompt] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [file, setFile] = useState<File | null>(null);
  
  // Student State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [studentName, setStudentName] = useState("");
  const [answers, setAnswers] = useState<number[]>([]);
  const [currentResult, setCurrentResult] = useState<Result | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [filterSubject, setFilterSubject] = useState("All");
  
  // Notes
  const [noteTitle, setNoteTitle] = useState("");
  const [noteFile, setNoteFile] = useState<File | null>(null);
  
  const [leaderboardQuiz, setLeaderboardQuiz] = useState<Quiz | null>(null);

  const showToast = (message: string, type: ToastType = "info") => {
      setToast({ message, type });
  };

  useEffect(() => {
    const qQuery = query(collection(db, "quizzes"), orderBy("createdAt", "desc"));
    const unsubscribeQuizzes = onSnapshot(qQuery, (snapshot) => {
      setQuizzes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Quiz)));
    });
    const nQuery = query(collection(db, "notes"), orderBy("createdAt", "desc"));
    const unsubscribeNotes = onSnapshot(nQuery, (snapshot) => {
      setNotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note)));
    });
    const rQuery = query(collection(db, "results"), orderBy("date", "desc"));
    const unsubscribeResults = onSnapshot(rQuery, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Result)));
    });
    return () => { unsubscribeQuizzes(); unsubscribeNotes(); unsubscribeResults(); };
  }, []);

  useEffect(() => {
    const savedName = localStorage.getItem("studentName");
    if(savedName) setStudentName(savedName);
  }, []);

  useEffect(() => {
    if (view === "student-quiz" && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev <= 1 ? 0 : prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (view === "student-quiz" && timeLeft === 0 && activeQuiz) {
      submitQuiz();
    }
  }, [timeLeft, view]);

  const handleAuth = () => {
    if (authPassword === "admin") {
      setIsAuthenticated(true);
      setView("teacher-dash");
      setShowAuth(false);
      setAuthPassword("");
      showToast("Welcome, Teacher!", "success");
    } else {
      showToast("Incorrect password. Hint: admin", "error");
    }
  };

  const handleCreateQuiz = async () => {
    if (!isAuthenticated) return;
    if (!prompt && !file) {
      showToast("Please provide a topic or upload a file.", "error");
      return;
    }
    setIsGenerating(true);
    try {
      let fileBase64 = null;
      let mimeType = null;
      if (file) {
        fileBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]); 
          reader.readAsDataURL(file);
        });
        mimeType = file.type;
      }
      const quiz = await generateQuiz(prompt, numQuestions, difficulty, fileBase64, mimeType);
      if (quiz) setGeneratedQuiz(quiz);
    } catch (e: any) {
      showToast("Failed to generate quiz: " + e.message, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateQuizField = (field: keyof Quiz, value: any) => {
    if (!generatedQuiz) return;
    setGeneratedQuiz({ ...generatedQuiz, [field]: value });
  };

  const updateQuestion = (index: number, field: keyof Question, value: any) => {
    if (!generatedQuiz) return;
    const questions = [...generatedQuiz.questions];
    questions[index] = { ...questions[index], [field]: value };
    setGeneratedQuiz({ ...generatedQuiz, questions });
  };

  const updateOption = (qIndex: number, optIndex: number, value: string) => {
    if (!generatedQuiz) return;
    const questions = [...generatedQuiz.questions];
    const options = [...questions[qIndex].options];
    options[optIndex] = value;
    questions[qIndex] = { ...questions[qIndex], options };
    setGeneratedQuiz({ ...generatedQuiz, questions });
  };

  const removeQuestion = (index: number) => {
    if (!generatedQuiz) return;
    if (generatedQuiz.questions.length <= 1) {
      showToast("Quiz must have at least one question.", "error");
      return;
    }
    const questions = generatedQuiz.questions.filter((_, i) => i !== index);
    setGeneratedQuiz({ ...generatedQuiz, questions });
  };

  const addQuestion = () => {
    if (!generatedQuiz) return;
    const newQuestion: Question = {
      text: "New Question",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 0,
      explanation: "Explanation for the correct answer."
    };
    setGeneratedQuiz({ ...generatedQuiz, questions: [...generatedQuiz.questions, newQuestion] });
  };

  const handleUploadNote = async () => {
    if (!isAuthenticated) return;
    if (!noteTitle || !noteFile) {
        showToast("Please provide a title and a file.", "error");
        return;
    }
    try {
      const fileBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]); 
        reader.readAsDataURL(noteFile);
      });
      await addDoc(collection(db, "notes"), {
        title: noteTitle,
        fileName: noteFile.name,
        fileData: fileBase64,
        mimeType: noteFile.type,
        createdAt: Date.now(),
      });
      setNoteTitle("");
      setNoteFile(null);
      showToast("Material uploaded successfully!", "success");
    } catch (e: any) {
        showToast("Upload failed: " + e.message, "error");
    }
  };

  const publishQuiz = async () => {
    if (!isAuthenticated || !generatedQuiz) return;
    try {
      const { id, ...quizData } = generatedQuiz;
      await addDoc(collection(db, "quizzes"), { ...quizData, createdAt: Date.now() });
      setGeneratedQuiz(null);
      setPrompt("");
      setFile(null);
      setNumQuestions(5);
      setView("teacher-dash");
      showToast("Quiz published successfully!", "success");
    } catch (e: any) {
        showToast("Publish failed: " + e.message, "error");
    }
  };

  const startQuiz = async (quiz: Quiz) => {
    if (!studentName.trim()) {
        showToast("Please enter your name first.", "error");
        return;
    }
    
    try {
        await updateDoc(doc(db, "quizzes", quiz.id), { starts: increment(1) });
    } catch(e) { console.log(e); }

    localStorage.setItem("studentName", studentName);
    setActiveQuiz(quiz);
    setAnswers(new Array(quiz.questions.length).fill(-1));
    setTimeLeft((quiz.durationMinutes || 10) * 60); 
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
      const docRef = await addDoc(collection(db, "results"), resultData);
      setCurrentResult({ id: docRef.id, ...resultData });
      setView("student-result");
      showToast("Quiz submitted successfully!", "success");
    } catch (e: any) {
        showToast("Submission failed: " + e.message, "error");
    }
  };

  const getLeaderboard = (quizId: string) => {
    const quizResults = results.filter(r => r.quizId === quizId).sort((a, b) => a.date - b.date);
    const uniqueResults: Result[] = [];
    const seen = new Set<string>();
    quizResults.forEach(r => {
        const key = `${r.studentName.trim().toLowerCase()}-${r.score}`;
        if (!seen.has(key)) { seen.add(key); uniqueResults.push(r); }
    });
    return uniqueResults.sort((a, b) => b.score !== a.score ? b.score - a.score : a.date - b.date);
  };

  const deleteItem = async (collectionName: string, id: string) => {
      if (!isAuthenticated) return;
      if (confirm("Are you sure you want to delete this item?")) {
        try {
            await deleteDoc(doc(db, collectionName, id));
            showToast("Item deleted.", "success");
        } catch(e: any) {
            showToast("Delete failed.", "error");
        }
      }
  };

  const Header = ({ title, onBack, rightContent }: any) => (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
            </button>
          )}
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {rightContent}
          <div className="text-sm font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full hidden sm:block">Chaudhary English Classes</div>
        </div>
      </div>
    </header>
  );

  // --- Views ---

  if (view === "landing") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-white relative overflow-hidden">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        
        {/* Abstract Background Shapes */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
             <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/20 rounded-full blur-3xl"></div>
             <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-purple-200/20 rounded-full blur-3xl"></div>
        </div>

        <div className="z-10 text-center max-w-5xl px-4 mb-12">
            <span className="inline-block px-4 py-1.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm mb-6 tracking-wide">
                AI-POWERED LEARNING PLATFORM
            </span>
            <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-slate-900 mb-6 tracking-tight leading-tight">
                <span className="whitespace-nowrap">Chaudhary English Classes</span> <br/>
                <span className="text-indigo-600">Smart Quizzes</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-600 mb-8 max-w-2xl mx-auto leading-relaxed">
                Automatically generate quizzes from study materials, track your progress, and earn certificates.
            </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl px-6 relative z-10">
          <button onClick={() => setShowAuth(true)} className="group relative bg-white p-8 rounded-2xl shadow-xl shadow-indigo-100/50 hover:shadow-2xl hover:shadow-indigo-200/50 transition-all duration-300 border border-white transform hover:-translate-y-1 text-left">
            <div className="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center mb-6 text-white shadow-lg shadow-indigo-200">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">Teacher Portal</h2>
            <p className="text-slate-500">Create content, upload notes, and monitor student analytics.</p>
          </button>

          <button onClick={() => setView("student-dash")} className="group relative bg-white p-8 rounded-2xl shadow-xl shadow-indigo-100/50 hover:shadow-2xl hover:shadow-indigo-200/50 transition-all duration-300 border border-white transform hover:-translate-y-1 text-left">
            <div className="w-14 h-14 bg-emerald-500 rounded-xl flex items-center justify-center mb-6 text-white shadow-lg shadow-emerald-200">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-emerald-600 transition-colors">Student Portal</h2>
            <p className="text-slate-500">Take quizzes, view leaderboards, and download study materials.</p>
          </button>
        </div>

        {showAuth && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm animate-fade-in-up">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-bold text-slate-900">Teacher Login</h3>
                <button onClick={() => setShowAuth(false)} className="text-slate-400 hover:text-slate-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>
              <input 
                type="password" 
                placeholder="Password" 
                className="w-full p-4 border border-slate-200 rounded-xl mb-4 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 text-slate-900 transition-all"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                autoFocus
              />
              <Button onClick={handleAuth} fullWidth>Access Dashboard</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "teacher-dash") {
    // Analytics
    const totalStudents = new Set(results.map(r => r.studentName.toLowerCase())).size;
    const globalAvg = results.length > 0 ? Math.round(results.reduce((acc, curr) => acc + (curr.score / curr.total), 0) / results.length * 100) : 0;

    return (
      <div className="min-h-screen bg-slate-50">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <Header title="Teacher Dashboard" onBack={() => setView("landing")} />
        <main className="max-w-6xl mx-auto p-6 space-y-8">
          
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StatCard 
                title="Active Quizzes" 
                value={quizzes.length} 
                color="bg-indigo-500"
                icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>}
              />
              <StatCard 
                title="Students Enrolled" 
                value={totalStudents} 
                color="bg-emerald-500"
                icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>}
              />
              <StatCard 
                title="Class Average" 
                value={`${globalAvg}%`} 
                color="bg-amber-500"
                icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
              />
          </div>

          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-800">Your Quizzes</h2>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setView("teacher-notes")}>Upload Notes</Button>
              <Button onClick={() => setView("teacher-create")}>+ New Quiz</Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.length === 0 ? (
              <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-xl border-2 border-dashed border-slate-200">
                <div className="mb-4 text-slate-300">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
                </div>
                <p className="text-lg font-medium">No quizzes created yet.</p>
                <p className="text-sm">Click "New Quiz" to get started with AI.</p>
              </div>
            ) : (
              quizzes.map(quiz => {
                const quizResults = results.filter(r => r.quizId === quiz.id);
                const avgScore = quizResults.length > 0
                    ? Math.round(quizResults.reduce((acc, curr) => acc + (curr.score / curr.total), 0) / quizResults.length * 100)
                    : null;

                return (
                    <Card key={quiz.id} hover className="flex flex-col h-full">
                        <div className="flex-1">
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="text-lg font-bold text-slate-800 line-clamp-1" title={quiz.title}>{quiz.title}</h3>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${quiz.subject === 'Science' ? 'bg-emerald-100 text-emerald-700' : quiz.subject === 'Math' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {quiz.subject || 'General'}
                                </span>
                            </div>
                            <div className="text-sm text-slate-500 mb-4 space-y-1">
                                <p className="flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> {quiz.questions.length} Questions</p>
                                <p className="flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> {quiz.durationMinutes || 10} Minutes</p>
                            </div>
                            
                            {avgScore !== null ? (
                                <div className="mb-4">
                                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                                        <span>Avg Score</span>
                                        <span className="font-bold">{avgScore}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${avgScore}%` }}></div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 mb-4 italic">No attempts yet</p>
                            )}
                        </div>
                        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                            <Button variant="secondary" className="text-xs" onClick={() => downloadPDF(quiz)}>PDF</Button>
                            <Button variant="secondary" className="text-xs" onClick={() => { setLeaderboardQuiz(quiz); setView("teacher-leaderboard"); }}>Leaderboard</Button>
                            <Button variant="danger" className="text-xs col-span-2" onClick={() => deleteItem("quizzes", quiz.id)}>Delete</Button>
                        </div>
                    </Card>
                );
              })
            )}
          </div>
        </main>
      </div>
    );
  }

  if (view === "teacher-create") {
    return (
      <div className="min-h-screen bg-slate-50">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <Header title="Create New Quiz" onBack={() => setView("teacher-dash")} />
        <main className="max-w-4xl mx-auto p-6">
          {!generatedQuiz ? (
            <Card className="animate-fade-in-up">
              <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800">AI Quiz Generator</h2>
                  <p className="text-slate-500">Provide a topic or upload a document, and we'll generate the questions.</p>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Number of Questions</label>
                  <input type="number" min="1" max="20" value={numQuestions} onChange={(e) => setNumQuestions(parseInt(e.target.value) || 5)} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div>
                         <label className="block text-sm font-semibold text-slate-700 mb-2">Difficulty</label>
                         <select className="w-full p-3 border border-slate-200 rounded-lg bg-white" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                             <option value="Easy">Easy</option>
                             <option value="Medium">Medium</option>
                             <option value="Hard">Hard</option>
                         </select>
                     </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Topic or Prompt</label>
                  <textarea className="w-full p-4 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[140px] bg-slate-50 transition-all" placeholder="e.g. The history of the Roman Empire, or paste an article here..." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                </div>
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                  <div className="relative flex justify-center text-xs uppercase tracking-wide"><span className="px-3 bg-white text-slate-400">or upload PDF</span></div>
                </div>
                <div>
                  <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-colors cursor-pointer" />
                  {file && <p className="mt-2 text-sm text-emerald-600 flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg> {file.name}</p>}
                </div>

                <Button onClick={handleCreateQuiz} disabled={isGenerating} fullWidth className="mt-4">
                  {isGenerating ? <div className="flex items-center justify-center gap-2"><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Generating...</div> : "Generate Quiz"}
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-6 animate-fade-in-up">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold text-slate-800">Review & Edit Quiz</h2>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setGeneratedQuiz(null)}>Discard</Button>
                  <Button onClick={publishQuiz}>Publish</Button>
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="md:col-span-2">
                    <label className="text-xs font-bold text-slate-400 uppercase">Title</label>
                    <input type="text" value={generatedQuiz.title} onChange={(e) => updateQuizField('title', e.target.value)} className="block w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-lg" />
                 </div>
                 <div>
                    <label className="text-xs font-bold text-slate-400 uppercase">Subject</label>
                    <input type="text" value={generatedQuiz.subject || ''} onChange={(e) => updateQuizField('subject', e.target.value)} className="block w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
                 <div>
                    <label className="text-xs font-bold text-slate-400 uppercase">Difficulty</label>
                     <select 
                        className="block w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={generatedQuiz.difficulty}
                        onChange={(e) => updateQuizField('difficulty', e.target.value as Difficulty)}
                     >
                         <option value="Easy">Easy</option>
                         <option value="Medium">Medium</option>
                         <option value="Hard">Hard</option>
                     </select>
                 </div>
                 <div>
                    <label className="text-xs font-bold text-slate-400 uppercase">Duration (Min)</label>
                    <input type="number" value={generatedQuiz.durationMinutes} onChange={(e) => updateQuizField('durationMinutes', parseInt(e.target.value) || 10)} className="block w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none" />
                 </div>
              </div>

              <div className="space-y-4">
                {generatedQuiz.questions.map((q, i) => (
                  <Card key={i}>
                    <div className="flex justify-between items-center mb-4">
                        <span className="font-bold text-indigo-600">Question {i + 1}</span>
                        <button onClick={() => removeQuestion(i)} className="text-red-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
                    </div>
                    
                    <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Question Text</label>
                        <textarea 
                            value={q.text} 
                            onChange={(e) => updateQuestion(i, 'text', e.target.value)}
                            className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-800 font-medium bg-white"
                            rows={2}
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Options (Select Correct Answer)</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {q.options.map((opt, optIdx) => (
                            <div key={optIdx} className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${optIdx === q.correctIndex ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                                <input 
                                    type="radio" 
                                    name={`q-${i}-correct`} 
                                    checked={optIdx === q.correctIndex} 
                                    onChange={() => updateQuestion(i, 'correctIndex', optIdx)}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-gray-300"
                                />
                                <span className="text-xs font-bold text-slate-400 w-4">{String.fromCharCode(65 + optIdx)}</span>
                                <input 
                                    type="text" 
                                    value={opt} 
                                    onChange={(e) => updateOption(i, optIdx, e.target.value)}
                                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-700 placeholder-slate-400"
                                />
                            </div>
                        ))}
                        </div>
                    </div>
                    
                    <div>
                         <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Explanation</label>
                         <textarea 
                             value={q.explanation || ''} 
                             onChange={(e) => updateQuestion(i, 'explanation', e.target.value)}
                             className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none"
                             rows={2}
                             placeholder="Explain why the answer is correct..."
                         />
                    </div>
                  </Card>
                ))}
                
                <Button variant="secondary" fullWidth onClick={addQuestion} className="border-dashed border-2 py-4 text-slate-500 hover:text-indigo-600">+ Add Question</Button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  if (view === "student-dash") {
    const allSubjects = ["All", ...Array.from(new Set(quizzes.map(q => q.subject || "General")))];
    const filteredQuizzes = filterSubject === "All" ? quizzes : quizzes.filter(q => (q.subject || "General") === filterSubject);
    const myResults = results.filter(r => r.studentName.toLowerCase() === studentName.toLowerCase()).slice(0, 3);
    
    const streak = calculateStreak(studentName, results);
    const hasMaster = hasGrammarMaster(studentName, results);
    const hasAnyTop3 = results.some(r => r.studentName.toLowerCase() === studentName.toLowerCase() && isTop3(studentName, r.quizId, results));

    return (
      <div className="min-h-screen bg-slate-50">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <Header title="Student Portal" onBack={() => setView("landing")} />
        <main className="max-w-6xl mx-auto p-6">
          <Card className="mb-8 !p-8 border-indigo-100">
             <h2 className="text-2xl font-bold text-slate-800 mb-2">Welcome Back, {studentName || 'Student'}!</h2>
             <p className="text-slate-500 mb-6">Ready to learn something new today?</p>
             <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Enter your full name to track progress..." className="w-full max-w-md p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          </Card>

          {studentName && (
              <div className="mb-10">
                  <h3 className="text-lg font-bold text-slate-800 mb-4">Your Achievements</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                      <Badge icon="🥇" title="Grammar Master" active={hasMaster} description="Score 100% on any quiz." />
                      <Badge icon="🔥" title="5-Day Streak" active={streak >= 5} description={`Current streak: ${streak} days.`} />
                      <Badge icon="⭐" title="Top 3 Leaderboard" active={hasAnyTop3} description="Reach the top 3 in any quiz." />
                  </div>
              </div>
          )}

          <div className="mb-8">
            <div className="flex flex-col md:flex-row justify-between items-end md:items-center mb-6 gap-4 border-b border-slate-200 pb-4">
              <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                  {allSubjects.map(sub => (
                      <button key={sub} onClick={() => setFilterSubject(sub)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${filterSubject === sub ? "bg-indigo-600 text-white shadow-md" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>{sub}</button>
                  ))}
              </div>
              <Button variant="secondary" onClick={() => setView("student-notes")}>Study Materials</Button>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredQuizzes.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-slate-500">No quizzes available for this subject.</div>
              ) : (
                  filteredQuizzes.map(quiz => (
                    <Card key={quiz.id} hover className="flex flex-col h-full group">
                    <div className="flex-1">
                        <div className="flex justify-between items-start mb-4">
                            <span className="text-xs font-bold text-indigo-500 uppercase tracking-wider">{quiz.subject || 'General'}</span>
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">{quiz.durationMinutes || 10} min</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors">{quiz.title}</h3>
                        <p className="text-slate-500 text-sm">{quiz.questions.length} Questions</p>
                    </div>
                    <Button onClick={() => startQuiz(quiz)} fullWidth className="mt-6">Start Quiz</Button>
                    </Card>
                ))
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (view === "student-quiz" && activeQuiz) {
    const isFinished = answers.every(a => a !== -1);
    const progress = Math.round((answers.filter(a => a !== -1).length / activeQuiz.questions.length) * 100);
    const criticalTime = timeLeft < 60;

    return (
      <div className="min-h-screen bg-slate-50">
        <div className="fixed top-0 left-0 w-full h-1 bg-slate-200 z-50">
            <div className="h-full bg-indigo-600 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        <Header 
          title={activeQuiz.title} 
          onBack={() => { if (confirm("Quit? Progress lost.")) setView("student-dash"); }} 
          rightContent={
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-bold ${criticalTime ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-700'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {formatTime(timeLeft)}
            </div>
          } 
        />
        <main className="max-w-3xl mx-auto p-6 pb-24">
          <div className="space-y-6">
            {activeQuiz.questions.map((q, idx) => (
                <div key={idx} id={`q-${idx}`} className={`bg-white rounded-xl border p-6 transition-all duration-300 ${answers[idx] !== -1 ? 'border-indigo-200 shadow-sm' : 'border-slate-200'}`}>
                    <div className="flex gap-4">
                        <span className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${answers[idx] !== -1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{idx + 1}</span>
                        <div className="flex-1">
                            <p className="text-lg font-medium text-slate-800 mb-4">{q.text}</p>
                            <div className="space-y-3">
                                {q.options.map((opt, optIdx) => (
                                <button key={optIdx} onClick={() => { const n = [...answers]; n[idx] = optIdx; setAnswers(n); }} 
                                    className={`w-full text-left p-4 rounded-lg border transition-all duration-200 flex items-center ${answers[idx] === optIdx ? "bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500" : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300"}`}
                                >
                                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center mr-3 text-xs ${answers[idx] === optIdx ? "bg-indigo-500 border-indigo-500 text-white" : "border-slate-300 text-slate-400"}`}>
                                        {String.fromCharCode(65 + optIdx)}
                                    </span>
                                    <span className={`text-sm ${answers[idx] === optIdx ? "text-indigo-900 font-medium" : "text-slate-600"}`}>{opt}</span>
                                </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            ))}
          </div>

          <div className="fixed bottom-0 left-0 w-full bg-white border-t border-slate-200 p-4 z-40">
             <div className="max-w-3xl mx-auto flex justify-between items-center">
                 <p className="text-sm text-slate-500">{answers.filter(a => a !== -1).length} of {activeQuiz.questions.length} answered</p>
                 <Button onClick={submitQuiz} disabled={!isFinished} className="px-8 shadow-lg shadow-indigo-200">Submit Quiz</Button>
             </div>
          </div>
        </main>
      </div>
    );
  }

  if (view === "student-result" && currentResult && activeQuiz) {
    const percentage = Math.round((currentResult.score / currentResult.total) * 100);
    const passed = percentage >= 80;

    return (
      <div className="min-h-screen bg-slate-50">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <Header title="Results" onBack={() => setView("student-dash")} />
        <main className="max-w-4xl mx-auto p-6 space-y-8">
          
          <Card className="text-center py-12 relative overflow-hidden bg-gradient-to-br from-white to-slate-50">
            {passed && <div className="absolute top-6 right-6 text-4xl animate-bounce">🏆</div>}
            
            <p className="text-slate-500 uppercase tracking-widest text-xs font-bold mb-4">Quiz Completed</p>
            <div className="text-7xl font-bold text-slate-900 mb-2 tracking-tighter">{percentage}%</div>
            <p className="text-xl text-slate-600 mb-8">You scored <strong className="text-indigo-600">{currentResult.score}</strong>/{currentResult.total}</p>
            
            <div className="flex justify-center gap-4">
                {passed && <Button variant="warning" onClick={() => downloadCertificate(studentName, activeQuiz.title, currentResult.score, currentResult.total)}>Download Certificate</Button>}
                <Button variant="secondary" onClick={() => downloadDetailedReport(studentName, activeQuiz, answers, currentResult.score, currentResult.total)}>Download Scorecard</Button>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-slate-800">Review</h3>
              {activeQuiz.questions.map((q, i) => {
                const isCorrect = answers[i] === q.correctIndex;
                return (
                  <Card key={i} className={`!p-5 border-l-4 ${isCorrect ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
                    <p className="font-medium text-slate-800 mb-3">{i+1}. {q.text}</p>
                    <div className="text-sm space-y-2">
                        <p className={isCorrect ? "text-emerald-700 font-medium" : "text-red-600 line-through"}>
                           {answers[i] === -1 ? "Skipped" : `You: ${q.options[answers[i]]}`}
                        </p>
                        {!isCorrect && <p className="text-emerald-700 font-medium">Correct: {q.options[q.correctIndex]}</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
            
            <div className="space-y-6">
               <h3 className="text-xl font-bold text-slate-800">Leaderboard</h3>
               <Card className="!p-0 overflow-hidden">
                   <table className="w-full text-sm">
                       <thead className="bg-slate-50 border-b border-slate-100">
                           <tr>
                               <th className="px-6 py-3 text-left font-semibold text-slate-500">Rank</th>
                               <th className="px-6 py-3 text-left font-semibold text-slate-500">Student</th>
                               <th className="px-6 py-3 text-right font-semibold text-slate-500">Score</th>
                           </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                           {getLeaderboard(activeQuiz.id).slice(0, 10).map((r, i) => (
                               <tr key={i} className={r.studentName === studentName ? "bg-indigo-50/50" : ""}>
                                   <td className="px-6 py-3 font-mono text-slate-400">#{i + 1}</td>
                                   <td className="px-6 py-3 font-medium text-slate-700">{r.studentName}</td>
                                   <td className="px-6 py-3 text-right font-bold text-indigo-600">{r.score}</td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </Card>
            </div>
          </div>
          
          <div className="flex justify-center pt-8">
            <Button onClick={() => setView("student-dash")} variant="ghost">Back to Dashboard</Button>
          </div>
        </main>
      </div>
    );
  }

  // Teacher Note Management and Leaderboard views remain similar but styled...
  if (view === "teacher-notes") {
      return (
          <div className="min-h-screen bg-slate-50">
             {toast && <Toast {...toast} onClose={() => setToast(null)} />}
             <Header title="Study Materials" onBack={() => setView("teacher-dash")} />
             <main className="max-w-3xl mx-auto p-6 space-y-8">
                <Card>
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Upload New Material</h2>
                    <div className="space-y-4">
                        <input type="text" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Title (e.g. Chapter 1 Summary)" className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
                        <input type="file" accept="application/pdf" onChange={(e) => setNoteFile(e.target.files ? e.target.files[0] : null)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                        <Button onClick={handleUploadNote}>Upload</Button>
                    </div>
                </Card>
                <div className="space-y-4">
                    {notes.map(note => (
                        <Card key={note.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-red-50 text-red-500 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg></div>
                                <div><h4 className="font-bold text-slate-800">{note.title}</h4><p className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</p></div>
                            </div>
                            <Button variant="danger" className="text-sm" onClick={() => deleteItem("notes", note.id)}>Delete</Button>
                        </Card>
                    ))}
                </div>
             </main>
          </div>
      )
  }

  if (view === "student-notes") {
      return (
          <div className="min-h-screen bg-slate-50">
             <Header title="Study Materials" onBack={() => setView("student-dash")} />
             <main className="max-w-4xl mx-auto p-6 grid gap-6 md:grid-cols-2">
                 {notes.length === 0 ? <p className="col-span-full text-center text-slate-500 py-12">No materials available.</p> : notes.map(note => (
                     <Card key={note.id} hover className="flex flex-col">
                         <div className="flex items-center gap-4 mb-4">
                             <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg"><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg></div>
                             <div><h3 className="font-bold text-slate-800">{note.title}</h3><p className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</p></div>
                         </div>
                         <div className="mt-auto grid grid-cols-2 gap-3">
                             <Button variant="secondary" className="text-sm" onClick={() => openBase64PDF(note.fileData, note.mimeType)}>View</Button>
                             <Button className="text-sm" onClick={() => downloadBase64File(note.fileData, note.fileName, note.mimeType)}>Download</Button>
                         </div>
                     </Card>
                 ))}
             </main>
          </div>
      )
  }

  if (view === "teacher-leaderboard" && leaderboardQuiz) {
      return (
          <div className="min-h-screen bg-slate-50">
              <Header title={`Leaderboard: ${leaderboardQuiz.title}`} onBack={() => setView("teacher-dash")} />
              <main className="max-w-3xl mx-auto p-6">
                  <Card className="!p-0 overflow-hidden">
                   <table className="w-full text-sm">
                       <thead className="bg-slate-50 border-b border-slate-100">
                           <tr>
                               <th className="px-6 py-4 text-left font-semibold text-slate-500">Rank</th>
                               <th className="px-6 py-4 text-left font-semibold text-slate-500">Student</th>
                               <th className="px-6 py-4 text-left font-semibold text-slate-500">Date</th>
                               <th className="px-6 py-4 text-right font-semibold text-slate-500">Score</th>
                           </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                           {getLeaderboard(leaderboardQuiz.id).map((r, i) => (
                               <tr key={i} className="hover:bg-slate-50 transition-colors">
                                   <td className="px-6 py-4 font-mono text-slate-400">#{i + 1}</td>
                                   <td className="px-6 py-4 font-medium text-slate-700">{r.studentName}</td>
                                   <td className="px-6 py-4 text-slate-500">{new Date(r.date).toLocaleDateString()}</td>
                                   <td className="px-6 py-4 text-right font-bold text-indigo-600">{r.score}/{r.total}</td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
                  </Card>
              </main>
          </div>
      )
  }

  return null;
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);