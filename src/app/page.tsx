"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, Settings, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, ShieldCheck, Truck, Layers, Menu, ChevronLeft, FileDown, Eye, 
  CheckCircle2, FileSearch, Database, Activity, Clock, BarChart3, PieChart as PieChartIcon,
  RefreshCw, AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation, Star, ShoppingBag, User as UserIcon,
  Mic, MicOff, Target, Headphones
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  addDocumentNonBlocking,
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  setDocumentNonBlocking
} from '@/firebase';
import { collection, query, orderBy, limit, where, doc, increment, arrayUnion, arrayRemove } from 'firebase/firestore';
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

// 定义核心预设策略
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
    id: 'speech-expert',
    name: '语音文件转译专家',
    description: '使用 TeleAI/TeleSpeechASR 模型，专注于语音内容的精准提取与语义分析。',
    content: '你是一个语音文件转译与语义分析专家。请对输入的语音转写文本进行精准校对、提炼要点并翻译为规范的格式。特别注意识别口语中的废话并过滤，保留核心技术参数、决策指令和关键时间点。',
    authorName: '系统预设',
    starCount: 888
  },
  {
    id: 'factory-expert',
    name: '工厂文件解析专家',
    description: '专注于 SOP、BOM 表、设备规格及维保安全规程的提取与分析。',
    content: '你是一个精通工厂设备管理和生产流程的专家。请重点分析文档中的技术参数、物料清单(BOM)、操作标准程序(SOP)以及安全生产规范。如果文档包含表格数据，请优先以表格形式呈现。',
    authorName: '系统预设',
    starCount: 888
  },
  {
    id: 'logistics-expert',
    name: '物流文件解析专家',
    description: '专注于货运清单、仓储计划、路由节点及交付标准的专业分析。',
    content: '你是一个物流供应链专家。请从文档中识别出运输计划、货物明细、路由节点以及交付时间表。请重点分析供应链的效率节点和潜在风险点。',
    authorName: '系统预设',
    starCount: 777
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
  
  // 语音识别状态
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const uploadedFilesRef = useRef<Map<string, File>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. 自动鉴权
  useEffect(() => {
    if (!user && auth) initiateAnonymousSignIn(auth);
  }, [user, auth]);

  // 2. 数据获取：用户文档列表
  const docsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'users', user.uid, 'documents'), orderBy('createdAt', 'desc'));
  }, [db, user?.uid]);
  const { data: documentsData, isLoading: isDocsLoading } = useCollection(docsQuery);
  const documents = documentsData || [];

  // 3. 数据获取：策略市场
  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'extractionStrategies'), where('isPublic', '==', true), orderBy('starCount', 'desc'));
  }, [db, user?.uid]);
  const { data: marketplaceStrategiesData } = useCollection(marketQuery);
  const marketplaceStrategies = marketplaceStrategiesData || [];

  // 合并系统策略和市场策略
  const allStrategies = useMemo(() => {
    return [...SYSTEM_STRATEGIES, ...marketplaceStrategies];
  }, [marketplaceStrategies]);

  // 当前挂载的策略对象
  const currentStrategy = useMemo(() => allStrategies.find(s => s.id === selectedRuleId) || SYSTEM_STRATEGIES[0], [allStrategies, selectedRuleId]);

  // 4. 数据获取：用户配置（收藏夹）
  const userProfileRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'users', user.uid);
  }, [db, user?.uid]);
  const { data: userProfile } = useDoc(userProfileRef);

  // 当前选中的文档
  const selectedDoc = useMemo(() => documents.find(d => d.id === selectedDocId), [documents, selectedDocId]);

  // 自动滚动聊天
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedDoc?.chatHistory, isChatting]);

  // 处理文件上传
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

  // 开启解析流
  const startAnalysis = async (docId: string) => {
    if (!selectedDoc || !user?.uid || !db) return;
    const file = uploadedFilesRef.current.get(docId);
    if (!file) {
      toast({ variant: "destructive", title: "本地文件缓存失效", description: "请重新上传此文件。" });
      return;
    }

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

      if (!finalContent.trim()) throw new Error('文档内容解析为空。');

      const fullContent = `\n# 文档内容: ${selectedDoc.name}\n\n${finalContent}\n`;
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { content: fullContent });

      setIsChatting(true);
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${currentStrategy.name}]：开启深度分析并输出概览与脉络。`, 
          rules: currentStrategy.content, 
          history: [] 
        })
      });

      if (!res.ok) throw new Error('AI 服务请求失败');
      
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
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
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
      toast({ variant: "destructive", title: "解析异常", description: err.message });
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'error' });
    } finally {
      setIsChatting(false);
    }
  };

  // 发送消息
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting || !user?.uid || !db) return;
    const userMsg: Message = { role: 'user', content: chatInput };
    const history = [...(selectedDoc.chatHistory || []), userMsg];
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { chatHistory: history });
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: selectedDoc.content, 
          userQuery: userMsg.content, 
          rules: currentStrategy.content, 
          history: selectedDoc.chatHistory 
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
              updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { 
                chatHistory: [...history, { role: 'model', content: fullAnswer }] 
              });
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "对话失败", description: err.message });
    } finally {
      setIsChatting(false);
    }
  };

  // 语音录制逻辑
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          setIsTranscribing(true);
          try {
            const { text } = await performASR({ audioBase64: base64Audio });
            if (text) {
              setChatInput(prev => prev + text);
              toast({ title: "识别成功", description: "已将语音转换为文本。" });
            }
          } catch (err: any) {
            toast({ variant: "destructive", title: "识别失败", description: err.message });
          } finally {
            setIsTranscribing(false);
          }
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      toast({ variant: "destructive", title: "麦克风权限错误", description: "请确保已允许浏览器访问麦克风。" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // 星标逻辑
  const toggleStar = (strategyId: string) => {
    if (!user?.uid || !db) return;
    if (SYSTEM_STRATEGIES.find(s => s.id === strategyId)) {
      toast({ title: "系统默认策略", description: "该策略为预设，无法进行星标操作。" });
      return;
    }
    const isStarred = userProfile?.starredStrategyIds?.includes(strategyId);
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid), {
      starredStrategyIds: isStarred ? arrayRemove(strategyId) : arrayUnion(strategyId)
    });
    
    updateDocumentNonBlocking(doc(db, 'extractionStrategies', strategyId), {
      starCount: increment(isStarred ? -1 : 1)
    });
  };

  const getFileIcon = (type: string) => {
    const t = type.toUpperCase();
    if (t.includes('PDF')) return <FileDown size={18} />;
    if (t.includes('DOC')) return <FileText size={18} />;
    if (t.includes('XLS') || t.includes('CSV')) return <FileSpreadsheet size={18} />;
    if (t.includes('PPT')) return <Presentation size={18} />;
    return <FileText size={18} />;
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full liquid-glass rounded-r-[3rem] overflow-hidden">
      <div className="p-8 flex items-center gap-5">
        <div className="w-14 h-14 bg-blue-600/90 rounded-[1.5rem] flex items-center justify-center shadow-2xl shadow-blue-500/40 text-white shrink-0">
          <BookOpen size={28} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-black text-white tracking-tight truncate leading-tight">DocuParse</h1>
          <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] truncate">Liquid AI Brain</p>
        </div>
      </div>
      
      <nav className="flex-1 px-4 space-y-6 mt-6 overflow-y-auto no-scrollbar">
        <div className="px-4">
           <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em] mb-5 pl-4">导航菜单</p>
           <div className="space-y-3">
              <button onClick={() => setActiveTab('chat')} className={cn("w-full flex items-center gap-4 px-6 py-4.5 rounded-[1.5rem] transition-all font-black text-[14px] tracking-wide", activeTab === 'chat' ? "bg-white/10 text-white shadow-xl border border-white/20" : "text-white/40 hover:bg-white/5 hover:text-white")}>
                <MessageSquare size={20} /> 智能对话
              </button>
              <button onClick={() => setActiveTab('marketplace')} className={cn("w-full flex items-center gap-4 px-6 py-4.5 rounded-[1.5rem] transition-all font-black text-[14px] tracking-wide", activeTab === 'marketplace' ? "bg-white/10 text-white shadow-xl border border-white/20" : "text-white/40 hover:bg-white/5 hover:text-white")}>
                <ShoppingBag size={20} /> 策略广场
              </button>
              <button onClick={() => setActiveTab('stats')} className={cn("w-full flex items-center gap-4 px-6 py-4.5 rounded-[1.5rem] transition-all font-black text-[14px] tracking-wide", activeTab === 'stats' ? "bg-white/10 text-white shadow-xl border border-white/20" : "text-white/40 hover:bg-white/5 hover:text-white")}>
                <BarChart3 size={20} /> 统计看板
              </button>
           </div>
        </div>

        <div className="px-4">
          <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em] mb-5 pl-4">挂载状态</p>
          <div className="p-5 bg-blue-500/10 rounded-[1.8rem] border border-blue-400/20 flex items-center gap-4 animate-in fade-in zoom-in-95">
            <div className="w-11 h-11 bg-blue-600 text-white rounded-[1.1rem] flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/30">
              <Target size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-black text-white truncate">{currentStrategy.name}</p>
              <p className="text-[10px] font-black text-blue-400 uppercase">Engine Ready</p>
            </div>
          </div>
        </div>

        <div className="px-4 flex items-center justify-between pb-8">
          <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.3em] pl-4">安全级别</p>
          <Badge variant="outline" className="text-[10px] font-black bg-blue-500/10 text-blue-400 border-none px-3 h-7 flex items-center gap-1.5 rounded-full">
            <ShieldCheck size={12} /> {user?.uid ? '企业隔离' : '校验中'}
          </Badge>
        </div>
      </nav>

      <div className="p-8 pb-12">
        <label className="group relative w-full flex items-center justify-center gap-3 bg-blue-600 text-white py-5 rounded-[2rem] transition-all shadow-2xl shadow-blue-600/40 cursor-pointer active:scale-95 hover:bg-blue-500">
          <Upload size={22} className="transition-transform group-hover:-translate-y-1" />
          <span className="text-[16px] font-black">上传技术文件</span>
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.csv" />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#020617] relative overflow-hidden text-white selection:bg-blue-500/30">
      {/* Liquid Blobs Background */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[150px] rounded-full animate-blob pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-400/10 blur-[150px] rounded-full animate-blob animation-delay-2000 pointer-events-none" />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-blue-800/20 blur-[120px] rounded-full animate-blob animation-delay-4000 pointer-events-none" />

      <aside className={cn("hidden lg:block transition-all duration-500 shrink-0 z-40", isSidebarOpen ? "w-[320px]" : "w-0")}>
        <SidebarContent />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="h-20 px-8 flex items-center justify-between bg-white/5 backdrop-blur-xl border-b border-white/10 sticky top-0 shrink-0">
          <div className="flex items-center gap-6">
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10"><Menu size={24} /></Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-[300px] border-none bg-transparent">
                  <SidebarContent />
                </SheetContent>
              </Sheet>
            </div>
            <Button variant="ghost" size="icon" className="hidden lg:flex text-white/40 hover:bg-white/10 rounded-xl" onClick={() => setIsSidebarOpen(!isSidebarOpen)}><ChevronLeft className={cn("transition-transform duration-300", !isSidebarOpen && "rotate-180")} size={24} /></Button>
            <h2 className="font-black text-white text-xl tracking-tight truncate">{activeTab === 'chat' ? '解析终端' : activeTab === 'marketplace' ? '规则广场' : '数据看板'}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Badge className="bg-blue-600/20 border-blue-400/30 text-blue-400 font-black px-5 py-2 shadow-2xl flex items-center gap-2.5 text-[13px] rounded-2xl whitespace-nowrap">
              <Sparkles size={16} className="animate-pulse" /> DeepSeek V3 Liquid
            </Badge>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-white/[0.02]">
            {/* List Section: 300px */}
            <div className={cn("w-full lg:w-[320px] border-b lg:border-b-0 lg:border-r border-white/5 bg-white/5 flex flex-col shrink-0", !selectedDocId && "flex-1 lg:flex-none lg:w-[320px]", selectedDocId && "hidden lg:flex")}>
              <div className="p-6">
                <div className="relative group">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-blue-400 transition-colors" size={20} />
                  <Input placeholder="检索历史文档..." className="pl-14 h-14 bg-white/5 border-white/10 rounded-2xl text-[14px] font-black placeholder:text-white/20 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50" />
                </div>
              </div>
              <ScrollArea className="flex-1 px-6">
                <div className="space-y-4 pb-20">
                  {documents.length === 0 ? (
                    <div className="py-32 text-center opacity-10"><FileSearch size={64} className="mx-auto mb-6" /><p className="text-[12px] font-black tracking-[0.3em] uppercase">等待数据载入</p></div>
                  ) : (
                    documents.map(d => (
                      <button key={d.id} onClick={() => setSelectedDocId(d.id)} className={cn("w-full p-5 rounded-[2rem] border transition-all duration-300 text-left flex items-start gap-5 group relative overflow-hidden", selectedDocId === d.id ? "bg-blue-600 shadow-2xl shadow-blue-600/30 border-blue-400" : "bg-white/5 border-transparent hover:bg-white/10 hover:border-white/10")}>
                        <div className={cn("w-11 h-11 rounded-[1.1rem] flex items-center justify-center shrink-0 shadow-lg", selectedDocId === d.id ? "bg-white text-blue-600" : "bg-white/10 text-white/60 group-hover:bg-white/20")}>{getFileIcon(d.type)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-[14px] truncate mb-2">{d.name}</p>
                          <div className="flex items-center gap-4">
                            <span className="text-[11px] font-black text-white/30">{new Date(d.createdAt).toLocaleDateString()}</span>
                            {d.status === 'completed' ? <Badge className="bg-green-500/20 text-green-400 text-[10px] h-6 border-none font-black px-3 rounded-full">OK</Badge> : <Badge className="bg-blue-500/20 text-blue-400 text-[10px] h-6 border-none font-black px-3 rounded-full animate-pulse">Running</Badge>}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Chat Section: Aligned Left */}
            <div className={cn("flex-1 flex flex-col relative", !selectedDocId && "hidden lg:flex")}>
              {selectedDoc ? (
                <>
                  <div className="lg:hidden p-6 border-b border-white/10 flex items-center bg-white/5 backdrop-blur-md">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDocId(null)} className="font-black text-white/60 gap-3 hover:text-white"><ChevronLeft size={20} /> 返回</Button>
                    <p className="ml-6 font-black text-white text-sm truncate">{selectedDoc.name}</p>
                  </div>
                  {selectedDoc.status === 'pending_confirm' ? (
                    <div className="flex-1 flex items-center justify-start p-8 lg:p-16">
                      <Card className="max-w-xl w-full rounded-[3rem] border-white/20 shadow-2xl bg-white/5 backdrop-blur-3xl p-10 lg:p-14 text-center animate-in zoom-in-95">
                        <div className="w-20 h-20 lg:w-28 lg:h-28 bg-blue-600/20 text-blue-400 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner border border-blue-400/20"><AlertCircle size={48} /></div>
                        <CardTitle className="text-2xl lg:text-3xl font-black mb-6 tracking-tight">准备开启解析</CardTitle>
                        <CardDescription className="text-[15px] lg:text-[17px] font-black text-white/40 mb-10 leading-relaxed uppercase tracking-wider">系统就绪，即将解析：<br/><span className="text-blue-400 font-black text-lg mt-2 block">{selectedDoc.name}</span></CardDescription>
                        <div className="space-y-5">
                          <Button onClick={() => startAnalysis(selectedDoc.id)} className="w-full h-16 lg:h-20 rounded-3xl bg-blue-600 hover:bg-blue-500 text-white font-black text-lg lg:text-xl shadow-2xl shadow-blue-600/40 flex items-center justify-center gap-4"><PlayCircle size={28} /> 激活 AI 深度解析</Button>
                          <Button variant="ghost" onClick={() => { deleteDocumentNonBlocking(doc(db, 'users', user?.uid!, 'documents', selectedDoc.id)); setSelectedDocId(null); }} className="text-white/20 font-black hover:text-red-400 transition-colors uppercase tracking-widest text-[12px]"><Trash2 size={20} className="mr-3" /> 移除并舍弃</Button>
                        </div>
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-8 lg:px-12 py-10 lg:py-16" ref={scrollRef}>
                        {/* Tight gap with the list */}
                        <div className="max-w-3xl space-y-10 lg:space-y-16 pb-40">
                          {selectedDoc.chatHistory?.map((m, i) => (
                            <div key={i} className={cn("flex gap-6 lg:gap-10", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                              <div className={cn("w-12 h-12 lg:w-14 lg:h-14 rounded-2xl lg:rounded-[1.4rem] flex items-center justify-center shrink-0 border border-white/10 shadow-lg font-black text-[14px]", m.role === 'user' ? "bg-white/10 text-white/40" : "bg-blue-600 text-white shadow-blue-600/30")}>{m.role === 'user' ? 'ME' : <Sparkles size={24} />}</div>
                              <div className={cn("max-w-[85%] lg:max-w-[95%] p-7 lg:p-10 rounded-[2rem] lg:rounded-[3rem] text-[15px] lg:text-[17px] leading-relaxed", m.role === 'user' ? "bg-blue-600/90 text-white rounded-tr-none shadow-2xl shadow-blue-600/20" : "bg-white/5 backdrop-blur-xl border border-white/10 rounded-tl-none prose prose-invert prose-blue")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {isChatting && (
                            <div className="flex gap-6 lg:gap-10">
                              <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl lg:rounded-[1.4rem] bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xl shadow-blue-600/30"><Sparkles size={24} /></div>
                              <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-7 lg:p-10 rounded-[2rem] lg:rounded-[3rem] rounded-tl-none flex items-center gap-5"><Loader2 className="animate-spin text-blue-400" size={24} /><span className="text-[14px] lg:text-[16px] font-black text-white/60 tracking-widest uppercase">研读中，正在构建流式脉络...</span></div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-8 lg:p-12 border-t border-white/5 bg-white/[0.03] backdrop-blur-3xl">
                        <div className="max-w-3xl relative">
                          <textarea placeholder={isRecording ? "正在监听音频..." : "向解析专家追问，或通过麦克风输入指令..."} className={cn("w-full min-h-[80px] lg:min-h-[90px] max-h-[300px] bg-white/5 border-white/10 rounded-[2.2rem] lg:rounded-[2.8rem] p-6 lg:p-9 pr-28 lg:pr-36 text-[15px] lg:text-[17px] font-black focus:ring-2 focus:ring-blue-500/20 shadow-inner resize-none no-scrollbar placeholder:text-white/20 transition-all text-white", isRecording && "bg-blue-500/10 border-blue-500/30")} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                          <div className="absolute right-4 lg:right-7 bottom-4 lg:bottom-7 flex items-center gap-3 lg:gap-5">
                             <Button onClick={isRecording ? stopRecording : startRecording} disabled={isTranscribing} variant="ghost" className={cn("w-12 h-12 lg:w-16 lg:h-16 rounded-2xl lg:rounded-[1.4rem] transition-all duration-300", isRecording ? "bg-blue-500 text-white animate-pulse" : "bg-white/5 text-white/30 hover:bg-white/10 hover:text-white")}>
                               {isTranscribing ? <Loader2 className="animate-spin" size={24} /> : isRecording ? <MicOff size={24} /> : <Mic size={24} />}
                             </Button>
                             <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting} className="w-12 h-12 lg:w-16 lg:h-16 rounded-2xl lg:rounded-[1.4rem] bg-blue-600 text-white shadow-2xl shadow-blue-600/40 hover:scale-110 active:scale-95 transition-all flex items-center justify-center border border-white/20"><Send size={24} /></Button>
                          </div>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-start justify-center p-12 lg:p-24 text-left">
                  <div className="w-28 h-28 lg:w-48 lg:h-48 bg-white/5 rounded-[3.5rem] lg:rounded-[4.5rem] shadow-2xl flex items-center justify-center mb-12 lg:mb-16 border border-white/10"><MessageSquare size={80} className="text-blue-500/20" /></div>
                  <h3 className="text-4xl lg:text-6xl font-black text-white tracking-tighter mb-8 leading-tight">解析工作站已就绪</h3>
                  <p className="text-white/20 font-black text-[14px] lg:text-[18px] max-w-md leading-relaxed uppercase tracking-[0.4em]">载入技术文档，开启液态流式深度解析</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marketplace' && (
          <ScrollArea className="flex-1 p-8 lg:p-16 bg-white/[0.02]">
            <div className="max-w-[1600px] mx-auto">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-16 lg:mb-24">
                <div>
                  <h3 className="text-4xl lg:text-7xl font-black text-white tracking-tighter mb-4">规则广场</h3>
                  <p className="text-white/20 text-sm lg:text-[18px] font-black uppercase tracking-[0.5em]">GLOBAL STRATEGY LIQUID</p>
                </div>
                <Badge className="bg-blue-600/10 text-blue-400 font-black px-6 py-3 text-[14px] border border-blue-500/20 rounded-2xl backdrop-blur-md">已载入 {allStrategies.length} 个深度专家</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 lg:gap-10">
                {allStrategies.map(s => (
                  <Card key={s.id} className={cn("rounded-[2.8rem] border-white/10 shadow-2xl bg-white/5 backdrop-blur-3xl hover:bg-white/10 transition-all duration-500 hover:-translate-y-4 group flex flex-col h-full overflow-hidden", selectedRuleId === s.id && "ring-4 ring-blue-600 shadow-blue-600/20")}>
                    <CardHeader className="p-8 lg:p-10">
                      <div className="flex items-start justify-between mb-8">
                        <div className={cn("w-16 h-16 lg:w-20 lg:h-20 rounded-[1.8rem] flex items-center justify-center shadow-inner transition-transform group-hover:scale-110", s.id.includes('expert') ? "bg-blue-600 text-white" : "bg-white/10 text-white/40")}>
                          {s.id === 'logistics-expert' ? <Truck size={32} /> : s.id === 'factory-expert' ? <Layers size={32} /> : s.id === 'speech-expert' ? <Headphones size={32} /> : <Sparkles size={32} />}
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => toggleStar(s.id)} className={cn("rounded-2xl transition-all h-12 w-12 lg:h-14 lg:w-14 hover:bg-white/10", userProfile?.starredStrategyIds?.includes(s.id) ? "text-amber-400" : "text-white/10 hover:text-amber-400")}><Star size={28} fill={userProfile?.starredStrategyIds?.includes(s.id) ? "currentColor" : "none"} /></Button>
                      </div>
                      <CardTitle className="text-lg lg:text-xl font-black leading-tight mb-4 tracking-tight">{s.name}</CardTitle>
                      <CardDescription className="text-[12px] lg:text-[13px] font-black line-clamp-2 h-12 text-white/30 leading-snug uppercase tracking-widest">{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-8 lg:p-10 flex-1 pb-6">
                      <div className="bg-black/20 p-6 lg:p-8 rounded-[2rem] text-[11px] lg:text-[12px] font-black text-white/20 line-clamp-6 h-32 lg:h-44 overflow-hidden leading-relaxed border border-white/5 italic">
                        {s.content}
                      </div>
                    </CardContent>
                    <CardFooter className="p-8 lg:p-10 pt-0 flex flex-col gap-6 mt-auto">
                      <div className="flex items-center justify-between w-full">
                         <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black text-white/40 uppercase">{s.authorName?.charAt(0)}</div>
                            <span className="text-[11px] font-black text-white/30 tracking-wider">{s.authorName}</span>
                         </div>
                         <div className="flex items-center gap-2 text-white/20 text-[11px] font-black"><Star size={12} fill="currentColor" /> {s.starCount}</div>
                      </div>
                      <Button onClick={() => { setSelectedRuleId(s.id); setActiveTab('chat'); toast({ title: "规则挂载成功", description: `引擎已切换至 [${s.name}]` }); }} className={cn("w-full h-14 lg:h-16 rounded-[1.5rem] font-black text-[14px] lg:text-[16px] shadow-2xl transition-all uppercase tracking-[0.2em]", selectedRuleId === s.id ? "bg-blue-600 text-white shadow-blue-600/40" : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10")}>
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
          <ScrollArea className="flex-1 p-8 lg:p-16 bg-white/[0.02]">
            <div className="max-w-4xl mx-auto text-center py-32 lg:py-48">
              <div className="w-32 h-32 lg:w-48 lg:h-48 bg-white/5 rounded-[4rem] lg:rounded-[6rem] shadow-2xl flex items-center justify-center mx-auto mb-16 border border-white/10"><Activity size={80} className="text-blue-500/10" /></div>
              <h3 className="text-5xl lg:text-7xl font-black text-white tracking-tighter mb-8 leading-tight">看板建设中</h3>
              <p className="text-white/20 font-black text-sm lg:text-[20px] uppercase tracking-[0.5em]">MONITORING INTERFACE CONNECTING...</p>
            </div>
          </ScrollArea>
        )}
      </main>

      <style jsx global>{`
        .prose p { @apply text-[15px] lg:text-[17px] leading-relaxed mb-6 lg:mb-8 text-white/70 font-medium; }
        .prose h1, .prose h2, .prose h3 { @apply font-black text-white mt-10 lg:mt-12 mb-6 lg:mb-8 tracking-tighter; }
        .prose table { @apply w-full border-collapse border border-white/10 rounded-[2rem] lg:rounded-[3rem] overflow-hidden my-8 lg:my-12 shadow-2xl bg-white/5; }
        .prose th { @apply bg-white/10 p-5 lg:p-7 text-[12px] lg:text-[14px] font-black uppercase text-white/40 text-left border-b border-white/10; }
        .prose td { @apply p-5 lg:p-7 border-t border-white/5 text-[14px] lg:text-[16px] text-white/60 font-medium; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}