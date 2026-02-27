
"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, Layers, Menu, ChevronLeft, FileDown,
  AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation, Star, ShoppingBag,
  Mic, MicOff, Target, Sun, Moon, BarChart3, Clock
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { 
  useUser, 
  useFirestore, 
  useCollection, 
  useDoc,
  useMemoFirebase,
  initiateAnonymousSignIn,
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  setDocumentNonBlocking
} from '@/firebase';
import { collection, query, orderBy, where, doc, increment, arrayUnion, arrayRemove } from 'firebase/firestore';
import { performASR } from '@/ai/flows/asr-flow';

// 配置 Server Action 超时时间为 120 秒
export const maxDuration = 120;

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface Message {
  role: 'user' | 'model';
  content: string;
}

const SYSTEM_STRATEGIES = [
  {
    id: 'universal-expert',
    name: '全能文件解析专家',
    description: '通用型深度解析。强制输出[文件概览]与[文件脉络]大纲。',
    content: '你是一个全能文件解析专家。请对该文档进行深度研读，并严格按以下格式输出：\n\n1. [文件概览]：用三句话精准总结文档核心内容。\n2. [文件脉络]：以 Markdown 列表形式列出文档的主要章节和逻辑结构大纲。\n3. [详细解析]：根据文档内容对用户的提问进行专业解答。',
    authorName: '系统预设',
    starCount: 999
  },
  {
    id: 'factory-expert',
    name: '工厂文件解析专家',
    description: '专注于 SOP、BOM 表、设备规格及维保安全规程的提取与分析。',
    content: '你是一个精通工厂设备管理和生产流程的专家。请重点分析文档中的技术参数、物料清单(BOM)、操作标准程序(SOP)以及安全生产规范。',
    authorName: '系统预设',
    starCount: 888
  },
  {
    id: 'logistics-expert',
    name: '物流文件解析专家',
    description: '专注于货运清单、仓储计划、路由节点及交付标准的专业分析。',
    content: '你是一个物流供应链专家。请从文档中识别出运输计划、货物明细、路由节点以及交付时间表。',
    authorName: '系统预设',
    starCount: 777
  },
  {
    id: 'speech-expert',
    name: '语音文件转译专家',
    description: '使用 TeleAI/TeleSpeechASR 模型，专注于语音内容的精准提取。',
    content: '你是一个语音文件转译专家。请根据输入的 ASR (语音转文字) 内容，首先输出校准后的完整原文本，确保修正冗余词汇、语气词及错别字，使语意连贯且标点准确。随后，请在回复的末尾增加一句引导语，例如：“以上是为您校准后的文本，您可以针对内容细节向我提问。”',
    authorName: '系统预设',
    starCount: 666
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const { user, auth } = useUser();
  const db = useFirestore();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'marketplace' | 'stats'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('universal-expert');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const uploadedFilesRef = useRef<Map<string, File>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user && auth) initiateAnonymousSignIn(auth);
  }, [user, auth]);

  const docsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'users', user.uid, 'documents'), orderBy('createdAt', 'desc'));
  }, [db, user?.uid]);
  const { data: documentsData } = useCollection(docsQuery);
  const documents = documentsData || [];

  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'extractionStrategies'), where('isPublic', '==', true), orderBy('starCount', 'desc'));
  }, [db, user?.uid]);
  const { data: marketplaceStrategiesData } = useCollection(marketQuery);
  const marketplaceStrategies = marketplaceStrategiesData || [];

  const allStrategies = useMemo(() => [...SYSTEM_STRATEGIES, ...marketplaceStrategies], [marketplaceStrategies]);
  const currentStrategy = useMemo(() => allStrategies.find(s => s.id === selectedRuleId) || SYSTEM_STRATEGIES[0], [allStrategies, selectedRuleId]);

  const userProfileRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'users', user.uid);
  }, [db, user?.uid]);
  const { data: userProfile } = useDoc(userProfileRef);

  const selectedDoc = useMemo(() => documents.find(d => d.id === selectedDocId), [documents, selectedDocId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedDoc?.chatHistory, isChatting]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user?.uid || !db) return;

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const docId = Math.random().toString(36).substring(2, 9);
      const newDoc = {
        name: file.name,
        type: ext.toUpperCase(),
        status: 'pending_confirm',
        content: '',
        userId: user.uid,
        createdAt: new Date().toISOString(),
        chatHistory: []
      };
      uploadedFilesRef.current.set(docId, file);
      setDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), newDoc, { merge: true });
      setSelectedDocId(docId);
    }
    e.target.value = '';
  };

  const startAnalysis = async (docId: string) => {
    if (!selectedDoc || !user?.uid || !db) return;
    const file = uploadedFilesRef.current.get(docId);
    if (!file) return;

    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'processing' });

    try {
      let finalContent = "";
      const ab = await file.arrayBuffer();
      if (selectedDoc.type === 'PDF') {
        const loadingTask = pdfjsLib.getDocument({ data: ab });
        const pdf = await loadingTask.promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item: any) => item.str).join(' ') + "\n";
        }
        finalContent = text;
      } else if (selectedDoc.type === 'DOCX' || selectedDoc.type === 'DOC') {
        const res = await mammoth.extractRawText({ arrayBuffer: ab });
        finalContent = res.value;
      } else if (selectedDoc.type === 'XLSX' || selectedDoc.type === 'XLS') {
        const workbook = XLSX.read(ab);
        finalContent = workbook.SheetNames.map(name => XLSX.utils.sheet_to_txt(workbook.Sheets[name])).join('\n\n');
      } else {
        finalContent = await file.text();
      }

      const fullContent = `\n# 文档内容: ${selectedDoc.name}\n\n${finalContent}\n`;
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { content: fullContent });

      setIsChatting(true);
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${currentStrategy.name}]：分析并输出。`, 
          rules: currentStrategy.content, 
          history: [] 
        })
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let leftover = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = leftover + decoder.decode(value, { stream: true });
        const lines = combined.split('\n');
        leftover = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim().startsWith('data: ')) continue;
          const dataStr = line.trim().slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const text = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (text) {
              fullAnswer += text;
              updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { 
                chatHistory: [{ role: 'model', content: fullAnswer }],
                status: 'completed'
              });
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'error' });
    } finally {
      setIsChatting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting || !user?.uid || !db) return;
    const history = [...(selectedDoc.chatHistory || []), { role: 'user', content: chatInput }];
    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { chatHistory: history });
    const userQuery = chatInput;
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentContent: selectedDoc.content, userQuery, rules: currentStrategy.content, history: selectedDoc.chatHistory })
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let leftover = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = leftover + decoder.decode(value, { stream: true });
        const lines = combined.split('\n');
        leftover = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim().startsWith('data: ')) continue;
          const dataStr = line.trim().slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const text = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (text) {
              fullAnswer += text;
              updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { 
                chatHistory: [...history, { role: 'model', content: fullAnswer }] 
              });
            }
          } catch (e) {}
        }
      }
    } catch (err) {} finally { setIsChatting(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => audioChunksRef.current.push(event.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          setIsTranscribing(true);
          try {
            const { text } = await performASR({ audioBase64: reader.result as string });
            if (text) setChatInput(prev => prev + text);
          } finally { setIsTranscribing(false); }
        };
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {}
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full tech-glass rounded-r-[2.5rem] overflow-hidden">
      <div className="p-8 pb-4 flex items-center gap-4">
        <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shrink-0">
          <BookOpen size={24} />
        </div>
        <div>
          <h1 className="text-lg font-black tracking-tight">DocuParse</h1>
          <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Liquid Brain</p>
        </div>
      </div>
      
      <nav className="flex-1 px-4 mt-8 space-y-6 overflow-y-auto no-scrollbar">
        <div>
          <p className="text-[11px] font-black opacity-40 uppercase tracking-[0.3em] mb-4 pl-4">功能主菜单</p>
          <div className="space-y-2 p-2"> {/* 增加 p-2 确保选中态 ring 不被遮挡 */}
            <button onClick={() => setActiveTab('chat')} className={cn("w-full h-16 flex items-center gap-4 px-6 rounded-2xl transition-all font-bold text-sm", activeTab === 'chat' ? "bg-primary text-white shadow-lg ring-4 ring-primary/20" : "opacity-60 hover:bg-black/5 hover:opacity-100")}>
              <MessageSquare size={18} /> 智能对话工作站
            </button>
            <button onClick={() => setActiveTab('marketplace')} className={cn("w-full h-16 flex items-center gap-4 px-6 rounded-2xl transition-all font-bold text-sm", activeTab === 'marketplace' ? "bg-primary text-white shadow-lg ring-4 ring-primary/20" : "opacity-60 hover:bg-black/5 hover:opacity-100")}>
              <ShoppingBag size={18} /> 全局策略广场
            </button>
            <button onClick={() => setActiveTab('stats')} className={cn("w-full h-16 flex items-center gap-4 px-6 rounded-2xl transition-all font-bold text-sm", activeTab === 'stats' ? "bg-primary text-white shadow-lg ring-4 ring-primary/20" : "opacity-60 hover:bg-black/5 hover:opacity-100")}>
              <BarChart3 size={18} /> 引擎数据看板
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-black opacity-40 uppercase tracking-[0.4em] mb-4 pl-4">当前挂载引擎</p>
          <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 flex items-center gap-3">
            <div className="w-10 h-10 bg-primary text-white rounded-xl flex items-center justify-center shrink-0 shadow-md">
              <Target size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black truncate">{currentStrategy.name}</p>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Engine Ready</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="p-6 pb-10 space-y-4">
        <div className="flex items-center justify-between px-4 py-3 bg-black/5 rounded-2xl border border-black/5">
           <div className="flex items-center gap-2">
              {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
              <span className="text-[11px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Night' : 'Day'} Mode</span>
           </div>
           <Switch checked={theme === 'dark'} onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')} />
        </div>
        <label className="w-full h-16 flex items-center justify-center gap-2 bg-primary text-white rounded-2xl transition-all shadow-xl cursor-pointer hover:bg-primary/90 font-black text-sm uppercase">
          <Upload size={20} /> 上传技术文件
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.doc,.xlsx,.xls,.csv" />
        </label>
      </div>
    </div>
  );

  return (
    <div className={cn("flex h-screen relative overflow-hidden transition-all duration-300", theme === 'dark' ? "dark bg-[#0f172a] text-white" : "bg-slate-50 text-slate-900")}>
      <aside className={cn("hidden lg:block transition-all duration-300 shrink-0 z-40", isSidebarOpen ? "w-[300px]" : "w-0")}>
        <SidebarContent />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-20 px-8 flex items-center justify-between border-b border-black/5 sticky top-0 shrink-0 bg-white/5 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild><Button variant="ghost" size="icon"><Menu size={24} /></Button></SheetTrigger>
                <SheetContent side="left" className="p-0 w-[300px] border-none bg-transparent"><SidebarContent /></SheetContent>
              </Sheet>
            </div>
            <Button variant="ghost" size="icon" className="hidden lg:flex opacity-40 hover:opacity-100" onClick={() => setIsSidebarOpen(!isSidebarOpen)}><ChevronLeft className={cn("transition-transform", !isSidebarOpen && "rotate-180")} size={24} /></Button>
            <h2 className="font-black text-lg tracking-widest uppercase">{activeTab === 'chat' ? '解析终端' : activeTab === 'marketplace' ? '规则广场' : '看板中心'}</h2>
          </div>
          <Badge className="bg-primary/20 border-primary/30 text-primary font-black px-4 py-1.5 rounded-xl uppercase tracking-widest text-[12px] flex items-center gap-2">
            <Sparkles size={14} /> DeepSeek V3 Liquid
          </Badge>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            <div className={cn("w-full lg:w-[300px] border-b lg:border-b-0 lg:border-r border-black/5 flex flex-col shrink-0 bg-white/5", !selectedDocId && "flex-1 lg:flex-none", selectedDocId && "hidden lg:flex")}>
              <div className="p-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                  <Input placeholder="搜索历史..." className="pl-12 h-12 bg-black/5 border-none rounded-xl text-sm" />
                </div>
              </div>
              <ScrollArea className="flex-1 px-4 pb-10">
                <div className="space-y-3 p-1">
                  {documents.map(d => (
                    <button key={d.id} onClick={() => setSelectedDocId(d.id)} className={cn("w-full p-4 rounded-2xl border transition-all text-left flex items-start gap-4", selectedDocId === d.id ? "bg-primary text-white shadow-xl border-primary" : "bg-black/5 border-transparent hover:bg-black/10")}>
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", selectedDocId === d.id ? "bg-white/20" : "bg-black/5 text-primary")}>
                        {d.type === 'PDF' && <FileText size={18} />}
                        {(d.type === 'DOCX' || d.type === 'DOC') && <FileText size={18} className="text-blue-500" />}
                        {(d.type === 'XLSX' || d.type === 'XLS' || d.type === 'CSV') && <FileSpreadsheet size={18} className="text-emerald-500" />}
                        {d.type === 'PPTX' && <Presentation size={18} className="text-orange-500" />}
                        {!['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'CSV', 'PPTX'].includes(d.type) && <FileText size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-[13px] truncate">{d.name}</p>
                        <p className="text-[11px] opacity-40 mt-1 font-bold">{new Date(d.createdAt).toLocaleDateString()}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className={cn("flex-1 flex flex-col relative bg-white/20", !selectedDocId && "hidden lg:flex")}>
              {selectedDoc ? (
                <>
                  <div className="lg:hidden p-4 border-b border-black/5 flex items-center bg-white/80">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDocId(null)} className="font-black opacity-60"><ChevronLeft size={18} /> 返回</Button>
                    <p className="ml-4 font-black text-sm truncate">{selectedDoc.name}</p>
                  </div>
                  {selectedDoc.status === 'pending_confirm' ? (
                    <div className="flex-1 flex items-center justify-start p-10 lg:p-20">
                      <Card className="max-w-md w-full rounded-[3rem] shadow-2xl p-10 text-center border-none bg-white/90">
                        <div className="w-20 h-20 bg-primary/10 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-6"><AlertCircle size={40} /></div>
                        <CardTitle className="text-2xl font-black mb-4">准备就绪</CardTitle>
                        <CardDescription className="font-bold opacity-60 mb-8 uppercase tracking-widest text-xs">即将解析: {selectedDoc.name}</CardDescription>
                        <Button onClick={() => startAnalysis(selectedDoc.id)} className="w-full h-16 rounded-2xl bg-primary text-lg font-black shadow-lg"><PlayCircle size={24} className="mr-2" /> 开启深度解析</Button>
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-8 lg:px-12 py-12" ref={scrollRef}>
                        <div className="max-w-3xl space-y-12 pb-32">
                          {selectedDoc.chatHistory?.map((m, i) => (
                            <div key={i} className={cn("flex gap-5", m.role === 'user' ? "flex-row-reverse text-right" : "flex-row text-left")}>
                              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-black/5 font-black text-[12px]", m.role === 'user' ? "bg-black/5" : "bg-primary text-white shadow-md")}>{m.role === 'user' ? 'ME' : <Sparkles size={18} />}</div>
                              <div className={cn("max-w-[90%] p-6 rounded-[2rem] text-sm lg:text-[15px] leading-relaxed shadow-sm", m.role === 'user' ? "bg-primary text-white rounded-tr-none" : "bg-white border border-black/5 rounded-tl-none prose prose-slate dark:prose-invert")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {isChatting && (
                            <div className="flex gap-5">
                              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0"><Loader2 className="animate-spin" size={18} /></div>
                              <div className="bg-white/80 p-6 rounded-[2rem] rounded-tl-none border border-black/5 animate-pulse text-sm font-bold opacity-40">专家研读中...</div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-8 lg:p-10 border-t border-black/5 bg-white/40 backdrop-blur-xl">
                        <div className="max-w-3xl relative">
                          <textarea placeholder={isRecording ? "正在倾听指令..." : "追问专家指令..."} className={cn("w-full min-h-[80px] bg-white border-black/10 rounded-[2rem] p-6 pr-32 text-sm lg:text-[15px] font-bold focus:ring-2 focus:ring-primary shadow-lg resize-none", isRecording && "ring-2 ring-red-500/50")} value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
                          <div className="absolute right-4 bottom-4 flex gap-3">
                             <Button onClick={isRecording ? () => mediaRecorderRef.current?.stop() : startRecording} disabled={isTranscribing} variant="ghost" className={cn("w-12 h-12 rounded-xl", isRecording ? "bg-red-500 text-white animate-pulse" : "bg-black/5")}>
                               {isTranscribing ? <Loader2 className="animate-spin" /> : isRecording ? <MicOff /> : <Mic />}
                             </Button>
                             <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting} className="w-12 h-12 rounded-xl bg-primary shadow-xl"><Send size={20} /></Button>
                          </div>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-10">
                  <MessageSquare size={120} />
                  <h3 className="text-3xl font-black mt-8 uppercase tracking-widest">终端就绪</h3>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marketplace' && (
          <ScrollArea className="flex-1 px-8 lg:px-16 py-12 bg-white/10">
            <div className="max-w-[1400px] mx-auto p-6"> {/* 增加 p-6 确保 ring-8 发光阴影有足够显示空间 */}
              <div className="mb-16">
                <h3 className="text-4xl font-black tracking-tight mb-2 uppercase">规则广场</h3>
                <p className="opacity-40 font-bold uppercase tracking-[0.4em] text-xs">Global Strategy Collection</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-10">
                {allStrategies.map(s => (
                  <Card key={s.id} className={cn("rounded-[2.5rem] border-none shadow-xl bg-white transition-all hover:-translate-y-2 flex flex-col h-full overflow-hidden", selectedRuleId === s.id && "ring-8 ring-primary shadow-2xl shadow-primary/30")}>
                    <CardHeader className="p-6">
                      <div className="flex justify-between items-start mb-6">
                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg", s.id.includes('universal') ? "bg-blue-600" : s.id.includes('speech') ? "bg-red-500" : "bg-slate-800")}>
                          {s.id.includes('speech') ? <Mic size={24} /> : <Sparkles size={24} />}
                        </div>
                        <Button variant="ghost" size="icon" className="opacity-20 hover:opacity-100 hover:text-amber-500"><Star size={20} /></Button>
                      </div>
                      <CardTitle className="text-base font-black mb-2">{s.name}</CardTitle>
                      <CardDescription className="text-[11px] font-bold opacity-40 leading-snug h-8 line-clamp-2 uppercase">{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-6 pb-4 flex-1">
                       <div className="bg-slate-50 p-4 rounded-2xl text-[10px] font-bold opacity-40 line-clamp-5 h-28 italic border border-slate-100">
                         {s.content}
                       </div>
                    </CardContent>
                    <CardFooter className="p-6 pt-0 flex flex-col gap-4">
                      <div className="flex justify-between items-center w-full px-1">
                        <span className="text-[10px] font-black opacity-30 uppercase">{s.authorName}</span>
                        <div className="flex items-center gap-1 opacity-20 text-[10px] font-black"><Star size={10} fill="currentColor" /> {s.starCount}</div>
                      </div>
                      <Button onClick={() => setSelectedRuleId(s.id)} className={cn("w-full h-12 rounded-xl font-black text-xs uppercase tracking-widest transition-all", selectedRuleId === s.id ? "bg-primary text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-200")}>
                        {selectedRuleId === s.id ? 'Using Now' : 'Mount Engine'}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}

        {activeTab === 'stats' && (
          <div className="flex-1 flex flex-col items-center justify-center opacity-5">
             <BarChart3 size={150} />
             <h3 className="text-4xl font-black mt-8 uppercase tracking-[1em]">数据连通中</h3>
          </div>
        )}
      </main>

      <style jsx global>{`
        .prose p { @apply text-sm lg:text-[15px] mb-4 opacity-70 font-bold leading-relaxed; }
        .prose h1, .prose h2 { @apply font-black mt-8 mb-4 tracking-tight uppercase; }
        .prose table { @apply w-full border-collapse rounded-xl overflow-hidden my-6 bg-slate-50/50; }
        .prose th { @apply bg-slate-100 p-4 text-[10px] font-black uppercase text-left border-b border-slate-200; }
        .prose td { @apply p-4 border-t border-slate-100 text-[13px] font-bold opacity-70; }
      `}</style>
    </div>
  );
}
