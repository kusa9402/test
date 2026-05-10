import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { 
  Search, 
  FileText, 
  Building2, 
  Target, 
  Save, 
  History, 
  Loader2, 
  UserCircle, 
  Briefcase, 
  AlertCircle, 
  Trash2, 
  CheckCircle2, 
  Upload, 
  FileUp, 
  X, 
  Link as LinkIcon, 
  PlusCircle, 
  PenLine, 
  Zap, 
  Plus, 
  Globe 
} from 'lucide-react';

/**
 * AI 면접 코치 - 하이패스 PRO (Main Logic)
 * 1. 로컬 환경에서 실행 시 Firebase 설정 및 API 키가 필요합니다.
 * 2. Tailwind CSS가 index.html 혹은 환경 설정에 포함되어 있어야 UI가 정상 출력됩니다.
 */

// Firebase 설정 (환경 변수 혹은 글로벌 변수로부터 읽어옴)
const firebaseConfig = JSON.parse(window.__firebase_config || '{}');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = window.__app_id || 'interview-coach-app-pro';
const apiKey = ""; // API 실행 환경에서 제공되는 키를 사용하거나 직접 입력이 필요합니다.

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('input');
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [archives, setArchives] = useState([]);
  const [message, setMessage] = useState(null);

  const [formData, setFormData] = useState({
    companyName: '',
    companyUrl: '',
    jobUrl: '',
    jobDescription: '',
    resume: ''
  });

  const [files, setFiles] = useState({ jobFile: null, resumeFile: null });
  const jobFileInputRef = useRef(null);
  const resumeFileInputRef = useRef(null);

  const [analysisResult, setAnalysisResult] = useState(null);
  const [manualQuestionInput, setManualQuestionInput] = useState("");

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (window.__initial_auth_token) {
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'archives');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setArchives(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (error) => console.error("Firestore error:", error));
    return () => unsubscribe();
  }, [user]);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showMessage("파일 크기는 5MB 이하여야 합니다.", "error");
      return;
    }
    setFiles(prev => ({ ...prev, [type]: file }));
    if (file.type === "text/plain") {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData(prev => ({ ...prev, [type === 'jobFile' ? 'jobDescription' : 'resume']: event.target.result }));
      };
      reader.readAsText(file);
    }
  };

  const handleAnswerChange = (section, index, value) => {
    setAnalysisResult(prev => {
      const updated = { ...prev };
      updated[section][index].answer = value;
      return updated;
    });
  };

  const callGeminiInitial = async (prompt) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              specificQuestions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    question: { type: "STRING" },
                    intent: { type: "STRING" },
                    tip: { type: "STRING" }
                  }
                }
              },
              commonQuestions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    question: { type: "STRING" },
                    answerGuide: { type: "STRING" }
                  }
                }
              },
              overallAnalysis: { type: "STRING" }
            }
          }
        }
      })
    });
    const data = await response.json();
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    return {
      ...parsed,
      commonQuestions: (parsed.commonQuestions || []).map(q => ({ ...q, answer: "" })),
      specificQuestions: (parsed.specificQuestions || []).map(q => ({ ...q, answer: "" })),
      userQuestions: []
    };
  };

  const handleAnalyze = async () => {
    if (!formData.companyName || (!formData.resume && !files.resumeFile)) {
      showMessage("회사명과 서류 내용은 필수입니다.", "error");
      return;
    }
    setLoading(true);
    const prompt = `
      당신은 10년 차 영업지원 전문 인사팀장입니다. 
      [주의사항] IT/SW 전문 용어(FAR, FRR 등)는 절대 사용하지 마세요. 신입 영업지원 지원자가 갖춘 역량과 지식 범위를 벗어나지 않는 직무 질문만 생성하세요.
      [직무] 영업지원 (주문관리, 수주관리, 채권관리, 지표 분석 등)
      [회사] ${formData.companyName}
      [공고] ${formData.jobDescription.substring(0, 1500)}
      [서류] ${formData.resume.substring(0, 2500)}
      기반으로 실무 중심 날카로운 질문 15개와 공통질문 5개를 생성하세요. 한국어로 답변하세요.
    `;
    try {
      const result = await callGeminiInitial(prompt);
      setAnalysisResult(result);
      setView('result');
      showMessage("분석이 완료되었습니다.");
    } catch (error) {
      showMessage("분석 중 오류 발생", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddThreeMore = async () => {
    if (moreLoading) return;
    setMoreLoading(true);
    const existingQuestions = analysisResult.specificQuestions.map(q => q.question).join("\n");
    const prompt = `영업지원 인사팀장으로서 기존과 중복되지 않는 새로운 실무 질문 3개를 추가로 생성하세요. JSON specificQuestions 배열로 출력. 기존: ${existingQuestions}`;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                specificQuestions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { question: { type: "STRING" }, intent: { type: "STRING" }, tip: { type: "STRING" } }
                  }
                }
              }
            }
          }
        })
      });
      const data = await response.json();
      const more = JSON.parse(data.candidates[0].content.parts[0].text);
      setAnalysisResult(prev => ({
        ...prev,
        specificQuestions: [...prev.specificQuestions, ...more.specificQuestions.map(q => ({ ...q, answer: "" }))]
      }));
      showMessage("질문 3개가 추가되었습니다.");
    } catch (error) {
      showMessage("추가 생성 실패", "error");
    } finally {
      setMoreLoading(false);
    }
  };

  const handleAddManualQuestion = () => {
    if (!manualQuestionInput.trim()) return;
    setAnalysisResult(prev => ({
      ...prev,
      userQuestions: [...(prev.userQuestions || []), {
        question: manualQuestionInput,
        answer: "",
        id: Date.now()
      }]
    }));
    setManualQuestionInput("");
    showMessage("질문이 추가되었습니다.");
  };

  const handleSaveToArchive = async () => {
    if (!user || !analysisResult) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'archives'), {
        ...formData,
        analysis: analysisResult,
        createdAt: serverTimestamp()
      });
      showMessage("아카이브에 저장되었습니다.");
      setView('archive');
    } catch (error) {
      showMessage("저장 실패", "error");
    }
  };

  const renderHeader = () => (
    <nav className="bg-white/70 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setView('input')}>
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:rotate-12 transition-all">
            <Zap size={20} fill="white" />
          </div>
          <span className="font-black text-xl tracking-tighter uppercase">PASS COACH <span className="text-blue-600">PRO</span></span>
        </div>
        <button onClick={() => setView('archive')} className={`text-sm font-bold px-4 py-2 rounded-xl transition-all ${view === 'archive' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-slate-900'}`}>아카이브</button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100 pb-20">
      {message && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl bg-white border border-slate-100 animate-in slide-in-from-top-4">
          {message.type === 'success' ? <CheckCircle2 className="text-green-500" /> : <AlertCircle className="text-red-500" />}
          <span className="font-bold">{message.text}</span>
        </div>
      )}

      {renderHeader()}

      <main className="max-w-7xl mx-auto py-8 px-6">
        {view === 'input' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
            <div className="text-center space-y-3">
              <h1 className="text-4xl font-black text-slate-900 leading-tight">영업지원 직무 맞춤형 <br/><span className="text-blue-600">심층 면접 설계</span></h1>
              <p className="text-slate-500 font-medium">로컬 개발 환경으로 구성된 PASS COACH PRO 버전입니다.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="space-y-6">
                <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-sm"><Building2 size={16} /> 기업 정보</div>
                  <div className="space-y-3">
                    <input type="text" placeholder="회사명 (필수)" className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold focus:ring-2 focus:ring-blue-500" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} />
                    <div className="relative">
                      <Globe size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" placeholder="홈페이지 URL" className="w-full p-3 pl-10 bg-slate-50 rounded-xl border-none outline-none text-xs" value={formData.companyUrl} onChange={e => setFormData({...formData, companyUrl: e.target.value})} />
                    </div>
                  </div>
                </section>
                <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-sm"><Target size={16} /> 모집 공고</div>
                  <div className="space-y-3">
                    <input type="text" placeholder="공고 URL" className="w-full p-3 bg-slate-50 rounded-xl border-none outline-none text-xs" value={formData.jobUrl} onChange={e => setFormData({...formData, jobUrl: e.target.value})} />
                    <button onClick={() => jobFileInputRef.current.click()} className="w-full p-4 border-2 border-dashed border-slate-200 rounded-2xl text-xs font-bold text-slate-400 hover:bg-blue-50">
                      {files.jobFile ? files.jobFile.name : "공고 파일 업로드"}
                    </button>
                    <input type="file" className="hidden" ref={jobFileInputRef} onChange={e => handleFileChange(e, 'jobFile')} />
                  </div>
                </section>
              </div>
              <div className="lg:col-span-2">
                <section className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100 h-full flex flex-col space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-600 font-bold"><FileText size={20} /> 서류 분석 대상</div>
                    <button onClick={() => resumeFileInputRef.current.click()} className="bg-slate-100 px-4 py-2 rounded-xl text-xs font-bold">
                      {files.resumeFile ? files.resumeFile.name : "서류 파일 첨부"}
                    </button>
                    <input type="file" className="hidden" ref={resumeFileInputRef} onChange={e => handleFileChange(e, 'resumeFile')} />
                  </div>
                  <textarea placeholder="자기소개서 내용을 입력하세요." className="flex-grow w-full min-h-[400px] p-6 bg-slate-50 rounded-3xl border-none outline-none font-medium leading-relaxed resize-none focus:ring-2 focus:ring-blue-500" value={formData.resume} onChange={e => setFormData({...formData, resume: e.target.value})} />
                </section>
              </div>
            </div>
            <button onClick={handleAnalyze} disabled={loading} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-xl hover:bg-blue-600 transition-all flex items-center justify-center gap-3 shadow-xl">
              {loading ? <Loader2 className="animate-spin" /> : <Search size={24} />} {loading ? "분석 중..." : "합격 리포트 생성 (15문항)"}
            </button>
          </div>
        )}

        {view === 'result' && analysisResult && (
          <div className="max-w-4xl mx-auto space-y-12 animate-in slide-in-from-bottom-8">
            <header className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 flex justify-between items-center">
              <h2 className="text-3xl font-black text-slate-900">{formData.companyName}</h2>
              <button onClick={handleSaveToArchive} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold hover:bg-blue-700 shadow-xl transition-all"><Save size={18}/> 결과 저장</button>
            </header>

            <section className="bg-slate-900 text-white p-8 rounded-[32px] shadow-xl">
              <div className="flex items-center gap-3 mb-6"><PenLine className="text-blue-400" /><h3 className="text-xl font-black">나만의 질문 추가</h3></div>
              <div className="flex gap-3">
                <input type="text" placeholder="준비한 예상 질문 입력..." className="flex-grow bg-white/10 border border-white/20 rounded-2xl px-6 py-4 outline-none text-white" value={manualQuestionInput} onChange={(e) => setManualQuestionInput(e.target.value)} />
                <button onClick={handleAddManualQuestion} className="bg-white text-slate-900 px-6 py-4 rounded-2xl font-black hover:bg-blue-500 hover:text-white transition-all">추가</button>
              </div>
              <div className="mt-6 space-y-4">
                {analysisResult.userQuestions?.map((q, idx) => (
                  <div key={q.id} className="bg-white/5 border border-white/10 p-6 rounded-2xl">
                    <p className="font-bold mb-4">{q.question}</p>
                    <textarea placeholder="답변 작성..." className="w-full h-24 bg-black/20 border border-white/5 rounded-xl p-4 text-sm text-white resize-none" value={q.answer} onChange={(e) => {
                        const updated = [...analysisResult.userQuestions];
                        updated[idx].answer = e.target.value;
                        setAnalysisResult({...analysisResult, userQuestions: updated});
                      }} />
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-8">
              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Zap className="text-blue-600" /> AI 추천 실무 질문 (15선)</h3>
              <div className="space-y-6">
                {analysisResult.specificQuestions.map((q, idx) => (
                  <div key={idx} className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm group hover:border-blue-200 transition-all">
                    <div className="space-y-4">
                      <p className="text-xl font-extrabold text-slate-900">{idx + 1}. {q.question}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-4 rounded-xl text-xs"><span className="font-black block mb-1">의도</span>{q.intent}</div>
                        <div className="bg-green-50 p-4 rounded-xl text-xs"><span className="font-black block mb-1 text-green-600">팀장님 Tip</span>{q.tip}</div>
                      </div>
                      <textarea placeholder="답변 연습..." className="w-full h-32 p-5 bg-slate-50 border border-slate-100 rounded-2xl text-sm outline-none transition-all resize-none shadow-inner" value={q.answer} onChange={e => handleAnswerChange('specificQuestions', idx, e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleAddThreeMore} disabled={moreLoading} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-[32px] text-slate-400 font-black hover:bg-blue-50 transition-all">
                {moreLoading ? "생성 중..." : "AI 질문 3개 더 받기"}
              </button>
            </div>
          </div>
        )}

        {view === 'archive' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
            <h2 className="text-3xl font-black text-slate-900">아카이브</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {archives.map(item => (
                <div key={item.id} className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-xl transition-all group flex flex-col justify-between" onClick={() => { setFormData(item); setAnalysisResult(item.analysis); setView('result'); }}>
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all"><Building2 size={20} /></div>
                      <button onClick={e => { e.stopPropagation(); if(window.confirm('삭제하시겠습니까?')) deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'archives', item.id)); }} className="text-slate-300 hover:text-red-500"><Trash2 size={18} /></button>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 mb-2">{item.companyName}</h3>
                    <p className="text-sm text-slate-500 line-clamp-2 italic">"{item.analysis.overallAnalysis}"</p>
                  </div>
                  <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-50 font-bold text-[10px] text-slate-400">
                    <span>{item.createdAt?.toDate().toLocaleDateString()}</span>
                    <span className="text-blue-600 bg-blue-50 px-3 py-1 rounded-full">{item.analysis.specificQuestions.length} AI + {item.analysis.userQuestions?.length || 0} USER</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur shadow-2xl px-8 py-3 rounded-full flex items-center gap-8 z-50 text-white font-bold text-xs uppercase tracking-widest">
        <button onClick={() => setView('input')} className={view === 'input' ? 'text-blue-400' : ''}>입력</button>
        <button onClick={() => setView('archive')} className={view === 'archive' ? 'text-blue-400' : ''}>보관함</button>
      </div>
    </div>
  );
};

export default App;