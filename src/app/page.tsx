"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Settings, 
  MessageSquare, 
  Send,
  Loader2,
  Trash2,
  Search,
  BookOpen,
  Sparkles,
  PlusCircle,
  FileSearch,
  ShieldCheck,
  Truck,
  Layers,
  Menu,
  ChevronLeft,
  FileDown,
  AlertTriangle,
  Eye,
  CheckCircle2,
  Table as TableIcon,
  FileSpreadsheet,
  Activity,
  Zap
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { chatWithDoc } from '@/ai/flows/chat-with-doc-flow';
import { performOCR } from '@/ai/flows/ocr-flow';
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface Message {
  role: 'user' | 'model';
  content: string;
}

interface Rule {
  id: string;
  name: string;
  icon: React.ReactNode;
  content: string;
}

interface Document {
  id: string;
  name: string;
  type: string;
  status: 'processing' | 'ocr_scanning' | 'completed' | 'error';
  content: string;
  date: string;
  chatHistory: Message[];
}

const DEFAULT_RULES: Rule[] = [
  { 
    id: '1', 
    name: '全能架构解析', 
    icon: <Layers size={16} />,
    content: '作为技术文档专家，请系统性地解析该文件。首先，请精准识别并按顺序例举出文档的所有章节目录。其次，提取全文各个章节的核心技术信息、管理要求或物流标准。最后，针对每个章节给出精炼的摘要分析。' 
  },
  { 
    id: '2', 
    name: '供应商合规审查', 
    icon: <ShieldCheck size={16} />,
    content: '重点核查文档中涉及供应商准入、质量控制、EHS合规性以及违规处罚的相关条款。请对比工厂标准，列出所有不符项或高风险点。' 
  },
  { 
    id: '3', 
    name: '物流装卸标准', 
    icon: <Truck size={16} />,
    content: '专注于提取物流作业标准、交货周期、装卸规范、托盘/包装要求以及运输保险相关条款。' 
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'rules'>('chat');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(DEFAULT_RULES[0].id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules[0];
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedDoc?.chatHistory, isChatting]);

  const testApiConnectivity = async () => {
    setIsTestingApi(true);
    try {
      // 1. 测试 DeepSeek-V3.2
      const dsResult = await chatWithDoc({
        documentContent: "API Test Context",
        userQuery: "请回复：DeepSeek-V3.2 连接正常。",
        rules: "None",
        history: []
      });
      
      toast({
        title: "DeepSeek-V3.2 通信成功",
        description: dsResult.answer,
      });

      // 2. 测试 Qwen3-VL (发送一个微小的占位图)
      const tinyWhitePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const ocrResult = await performOCR({
        images: [{ pageIndex: 0, dataUri: tinyWhitePixel }]
      });

      if (ocrResult.results[0].text.includes('失败')) {
        throw new Error("Qwen3-VL 响应异常");
      }

      toast({
        title: "Qwen3-VL-8B 通信成功",
        description: "视觉识别引擎响应正常。",
      });

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "API 连接失败",
        description: error.message || "请检查硅基流动 API 密钥或模型 ID 是否正确。",
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  const processPDF = async (file: File, fileId: string): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      const pagesData: { text: string; imageData?: string }[] = [];
      const imagesToOCR: { pageIndex: number; dataUri: string }[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        let pageText = (textContent.items as any[]).map(item => item.str).join(' ').trim();
        
        if (pageText.length < 50) {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            const dataUri = canvas.toDataURL('image/jpeg', 0.85);
            imagesToOCR.push({ pageIndex: i - 1, dataUri });
            pagesData.push({ text: "" });
          } else {
            pagesData.push({ text: pageText });
          }
        } else {
          pagesData.push({ text: pageText });
        }
      }

      if (imagesToOCR.length > 0) {
        setDocuments(prev => prev.map(d => d.id === fileId ? { ...d, status: 'ocr_scanning' } : d));
        const ocrResponse = await performOCR({ images: imagesToOCR });
        
        ocrResponse.results.forEach(res => {
          pagesData[res.pageIndex].text = res.text;
        });
      }

      return pagesData.map((p, idx) => `### 第 ${idx + 1} 页 ###\n\n${p.text}`).join('\n\n');

    } catch (err: any) {
      console.error('PDF Process Error:', err);
      throw new Error(`PDF 处理失败: ${err.message}`);
    }
  };

  const processOfficeFile = async (file: File, extension: string): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    
    if (extension === 'docx') {
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } 
    
    if (['xlsx', 'xls', 'csv'].includes(extension)) {
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      let fullContent = "";
      workbook.SheetNames.forEach(name => {
        const worksheet = workbook.Sheets[name];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const mdTable = json.map((row: any) => `| ${row.join(' | ')} |`).join('\n');
        fullContent += `\n### 工作表: ${name} ###\n\n${mdTable}\n`;
      });
      return fullContent;
    }

    return await file.text();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const fileId = Math.random().toString(36).substring(2, 9);
      
      try {
        const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
        const newDoc: Document = {
          id: fileId,
          name: file.name,
          type: fileExtension.toUpperCase(),
          status: 'processing',
          content: '',
          date: new Date().toLocaleDateString(),
          chatHistory: []
        };

        setDocuments(prev => [newDoc, ...prev]);
        setSelectedDocId(fileId);

        let finalContent = '';
        if (fileExtension === 'pdf') {
          finalContent = await processPDF(file, fileId);
        } else if (['docx', 'xlsx', 'xls', 'csv', 'pptx'].includes(fileExtension)) {
          finalContent = await processOfficeFile(file, fileExtension);
        } else {
          finalContent = await file.text();
        }

        const markdownContent = `\n# 文档内容: ${file.name}\n\n${finalContent}\n`;
        setDocuments(prev => prev.map(d => d.id === fileId ? { ...d, content: markdownContent, status: 'completed' } : d));
        
        autoAnalyze(fileId, markdownContent);

      } catch (err: any) {
        setDocuments(prev => prev.map(d => d.id === fileId ? { ...d, status: 'error' } : d));
        toast({ variant: "destructive", title: "处理失败", description: err.message });
      }
    }
  };

  const autoAnalyze = async (docId: string, content: string) => {
    setIsChatting(true);
    try {
      const response = await chatWithDoc({
        documentContent: content,
        userQuery: "请执行全能架构解析：精准识别文档所有章节目录，并提取各章节的核心技术要求、合规标准或物流细节。请以清晰的 Markdown 结构呈现。",
        rules: activeRule.content,
        history: []
      });

      setDocuments(prev => prev.map(d => 
        d.id === docId ? { 
          ...d, 
          status: 'completed', 
          chatHistory: [{ role: 'model', content: response.answer }] 
        } : d
      ));
    } catch (error: any) {
      toast({ variant: "destructive", title: "自动分析失败", description: error.message });
    } finally {
      setIsChatting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting) return;

    const userMsg: Message = { role: 'user', content: chatInput };
    setDocuments(prev => prev.map(d => 
      d.id === selectedDoc.id ? { ...d, chatHistory: [...d.chatHistory, userMsg] } : d
    ));
    setChatInput('');
    setIsChatting(true);

    try {
      const response = await chatWithDoc({
        documentContent: selectedDoc.content,
        userQuery: chatInput,
        rules: activeRule.content,
        history: selectedDoc.chatHistory
      });

      const modelMsg: Message = { role: 'model', content: response.answer };
      setDocuments(prev => prev.map(d => 
        d.id === selectedDoc.id ? { ...d, chatHistory: [...d.chatHistory, modelMsg] } : d
      ));
    } catch (error: any) {
      toast({ variant: "destructive", title: "发送失败", description: error.message });
    } finally {
      setIsChatting(false);
    }
  };

  const NavContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 min-w-0 overflow-hidden">
      <div className="p-6 flex items-center gap-3 shrink-0">
        <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-lg shadow-primary/20 shrink-0">
          <BookOpen size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight truncate">DocuParse Pro</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold truncate">全能文档 AI 助理</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar min-h-0">
        <Button 
          variant={activeTab === 'chat' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11 rounded-xl"
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={18} /> 文档智能对话
        </Button>
        <Button 
          variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11 rounded-xl"
          onClick={() => setActiveTab('rules')}
        >
          <Settings size={18} /> 解析策略库
        </Button>

        <div className="mt-8 mb-2 px-3 flex items-center justify-between">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">活跃解析策略</p>
        </div>
        {rules.map(rule => (
          <button 
            key={rule.id}
            onClick={() => setSelectedRuleId(rule.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left min-w-0",
              selectedRuleId === rule.id 
                ? "bg-primary/10 text-primary font-semibold ring-1 ring-primary/20" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="shrink-0">{rule.icon}</span>
            <span className="truncate">{rule.name}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t bg-muted/20 shrink-0">
        <label className="w-full cursor-pointer flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-3.5 rounded-2xl transition-all shadow-lg shadow-primary/30 active:scale-[0.98]">
          <Upload size={18} /> <span className="text-sm font-bold tracking-wide truncate">上传 Office/PDF</span>
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.xlsx,.xls,.pptx,.csv" />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-muted/30 overflow-hidden font-sans">
      <aside className={cn(
        "hidden md:flex flex-col border-r transition-all duration-300 bg-white dark:bg-slate-900 shrink-0",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>
        <NavContent />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
        <header className="h-16 px-6 border-b flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden shrink-0">
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <SheetHeader className="sr-only">
                  <SheetTitle>导航菜单</SheetTitle>
                  <SheetDescription>访问文档对话和解析规则设置</SheetDescription>
                </SheetHeader>
                <NavContent />
              </SheetContent>
            </Sheet>
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden md:flex text-muted-foreground hover:text-primary shrink-0" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <ChevronLeft size={20} className={cn("transition-transform", !isSidebarOpen && "rotate-180")} />
            </Button>
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-extrabold text-sm hidden sm:inline-block tracking-tight text-slate-700 dark:text-slate-200 shrink-0">
                {activeTab === 'chat' ? '文档分析控制台' : '解析策略配置'}
              </span>
              {selectedDoc && activeTab === 'chat' && (
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 rounded-lg py-1 px-3 min-w-0 max-w-[120px] sm:max-w-[180px]">
                  {selectedDoc.type === 'PDF' ? <FileDown size={12} className="mr-1.5 shrink-0" /> : <FileText size={12} className="mr-1.5 shrink-0" />}
                  <span className="truncate">{selectedDoc.name}</span>
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2.5 px-4 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">DeepSeek-V3.2 + Qwen3-VL-8B 活跃</span>
            </div>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-w-0">
            <div className={cn(
              "w-full md:w-80 md:min-w-80 md:max-w-80 border-r bg-slate-50/50 dark:bg-slate-900/50 flex flex-col shrink-0 overflow-hidden",
              selectedDocId ? "hidden md:flex" : "flex"
            )}>
              <div className="p-4 border-b bg-white dark:bg-slate-900 shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="检索历史文档..." className="pl-10 h-10 text-xs rounded-xl bg-muted/40 border-none focus-visible:ring-primary/30" />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2.5 overflow-hidden min-w-0">
                  {documents.length === 0 ? (
                    <div className="text-center py-24 opacity-30">
                      <FileSearch className="mx-auto mb-4 text-primary" size={48} />
                      <p className="text-[11px] font-bold tracking-widest uppercase">等待文件上传</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <button 
                        key={doc.id} 
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "w-full p-3.5 rounded-2xl border text-left transition-all duration-200 group overflow-hidden block relative",
                          selectedDocId === doc.id 
                            ? "border-primary bg-white dark:bg-slate-800 shadow-xl shadow-primary/5 ring-1 ring-primary/20" 
                            : "hover:bg-white dark:hover:bg-slate-800 border-transparent bg-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            "p-2.5 rounded-xl transition-colors shrink-0", 
                            selectedDocId === doc.id ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          )}>
                            {doc.type === 'PDF' && <FileDown size={18} />}
                            {['XLSX', 'XLS', 'CSV'].includes(doc.type) && <FileSpreadsheet size={18} />}
                            {['DOCX', 'TXT', 'PPTX'].includes(doc.type) && <FileText size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[13px] truncate text-slate-800 dark:text-slate-200">{doc.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 min-w-0">
                              <p className="text-[10px] text-muted-foreground font-medium shrink-0">{doc.date}</p>
                              {doc.status === 'completed' && (
                                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-green-50 text-green-600 border-green-100 shrink-0">
                                  <CheckCircle2 size={8} className="mr-1" /> 已解析
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {doc.status === 'processing' && (
                          <div className="mt-3 flex items-center gap-2.5 text-[10px] text-primary font-bold bg-primary/5 p-2 rounded-lg border border-primary/10 overflow-hidden">
                            <Loader2 size={12} className="animate-spin shrink-0" /> 
                            <span className="truncate">深度解析中...</span>
                          </div>
                        )}
                        {doc.status === 'ocr_scanning' && (
                          <div className="mt-3 flex items-center gap-2.5 text-[10px] text-blue-500 font-bold bg-blue-50 p-2 rounded-lg border border-blue-100 overflow-hidden">
                            <Eye size={12} className="animate-pulse shrink-0" /> 
                            <span className="truncate">Qwen3-VL-8B 视觉引擎识别中...</span>
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className={cn(
              "flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-hidden relative min-w-0",
              !selectedDocId && "hidden md:flex"
            )}>
              {selectedDoc ? (
                <>
                  <div className="md:hidden p-4 border-b bg-white dark:bg-slate-950 flex items-center shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDocId(null)} className="gap-2">
                      <ChevronLeft size={16} /> 返回列表
                    </Button>
                    <span className="ml-auto font-bold text-xs truncate max-w-[200px]">{selectedDoc.name}</span>
                  </div>
                  
                  <ScrollArea className="flex-1 px-4 md:px-12 py-8" ref={scrollRef}>
                    <div className="max-w-4xl mx-auto space-y-8 pb-20 min-w-0">
                      {selectedDoc.chatHistory.map((msg, i) => (
                        <div key={i} className={cn("flex gap-3 sm:gap-5 min-w-0", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                          <div className={cn(
                            "w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
                            msg.role === 'user' ? "bg-slate-100 dark:bg-slate-800" : "bg-primary text-primary-foreground shadow-primary/20"
                          )}>
                            {msg.role === 'user' ? <span className="text-[10px] sm:text-xs font-bold">用户</span> : <Sparkles size={16} className="sm:size-5" />}
                          </div>
                          <div className={cn(
                            "max-w-[90%] p-4 sm:p-5 rounded-2xl sm:rounded-3xl text-[13px] sm:text-[14px] leading-relaxed shadow-sm transition-all overflow-x-auto min-w-0",
                            msg.role === 'user' 
                              ? "bg-primary text-primary-foreground rounded-tr-none" 
                              : "bg-slate-50 dark:bg-slate-900 border rounded-tl-none text-foreground prose dark:prose-invert prose-sm prose-slate"
                          )}>
                            {msg.role === 'user' ? (
                              msg.content
                            ) : (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            )}
                          </div>
                        </div>
                      ))}
                      {isChatting && (
                        <div className="flex gap-3 sm:gap-5 min-w-0">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                            <Sparkles size={16} className="sm:size-5" />
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900 border p-4 sm:p-5 rounded-2xl sm:rounded-3xl rounded-tl-none shadow-sm flex flex-col gap-3 max-w-[85%] min-w-0">
                            <div className="flex items-center gap-3 min-w-0">
                              <Loader2 size={16} className="animate-spin text-primary shrink-0" />
                              <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 dark:text-slate-300 truncate">DeepSeek-V3.2 深度研读中...</span>
                            </div>
                            <div className="h-1 w-32 sm:w-48 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-primary animate-progress-scan w-1/3 rounded-full" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <footer className="p-4 sm:p-6 md:p-8 border-t bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl shrink-0">
                    <div className="max-w-4xl mx-auto flex flex-col gap-4">
                      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-2 px-2">
                         {['识别全文目录', '分析合规风险点', '提取物流参数', '总结装卸标准'].map((hint, idx) => (
                           <Badge 
                             key={hint} 
                             variant="secondary" 
                             className="cursor-pointer hover:bg-primary hover:text-white transition-all whitespace-nowrap py-1.5 sm:py-2 px-3 sm:px-4 rounded-full border-none bg-slate-100 dark:bg-slate-800 text-[10px] sm:text-[11px] font-bold shrink-0"
                             onClick={() => setChatInput(hint)}
                           >
                             {hint}
                           </Badge>
                         ))}
                      </div>
                      <div className="relative">
                        <Textarea 
                          placeholder="输入您的问题 (DeepSeek-V3.2 已挂载全文)..."
                          className="min-h-[50px] sm:min-h-[60px] max-h-[200px] resize-none py-4 sm:py-5 px-5 sm:px-6 pr-14 sm:pr-16 rounded-2xl sm:rounded-3xl bg-slate-50 dark:bg-slate-900/50 border-none focus-visible:ring-primary/20 text-[13px] sm:text-[14px] shadow-inner"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />
                        <Button 
                          size="icon" 
                          className="absolute right-2.5 sm:right-3 bottom-2.5 sm:bottom-3 h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl shadow-lg shadow-primary/30 transition-transform active:scale-90" 
                          onClick={handleSendMessage}
                          disabled={!chatInput.trim() || isChatting || selectedDoc.status !== 'completed'}
                        >
                          <Send size={18} className="sm:size-5" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-center text-muted-foreground font-medium truncate">数据经过硅基流动加密传输，确保工厂信息安全</p>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 text-center">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white dark:bg-slate-900 rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl shadow-primary/10 flex items-center justify-center mb-6 sm:mb-8 border border-slate-100">
                    <MessageSquare size={32} className="sm:size-10 text-primary/40" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black tracking-tight">上传文档以开启对话</h3>
                  <p className="text-[13px] sm:text-sm text-muted-foreground mt-3 max-w-xs sm:max-w-sm leading-relaxed font-medium">
                    支持 Office 全家桶 (Word/Excel)、PDF、PPT、CSV。扫描件由 Qwen3-VL 视觉引擎分页识别。
                  </p>
                  <Button variant="outline" className="mt-8 sm:mt-10 rounded-xl sm:rounded-2xl px-8 sm:px-10 py-5 sm:py-7 h-auto border-2 hover:bg-primary hover:text-white transition-all group" asChild>
                    <label className="cursor-pointer">
                      <Upload className="mr-2 sm:mr-3 transition-transform group-hover:-translate-y-1" size={18} /> 
                      <span className="font-bold tracking-wide">立即上传</span>
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.xlsx,.xls,.pptx,.csv" />
                    </label>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <ScrollArea className="flex-1 p-4 sm:p-6 md:p-12 bg-slate-50/30">
            <div className="max-w-6xl mx-auto">
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 sm:mb-12">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black tracking-tight">解析策略库</h3>
                  <p className="text-muted-foreground text-[13px] sm:text-sm mt-2 font-medium">
                    选中的策略将作为“深度提示词”注入 AI，指导其阅读维度
                  </p>
                </div>
                <Button 
                  onClick={testApiConnectivity} 
                  disabled={isTestingApi}
                  variant="outline"
                  className="rounded-xl border-primary text-primary hover:bg-primary hover:text-white transition-all gap-2 h-11 px-6 shadow-sm"
                >
                  {isTestingApi ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
                  <span className="font-bold tracking-tight">API 连通性自检</span>
                </Button>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                {rules.map(rule => (
                  <Card key={rule.id} className={cn(
                    "transition-all border-2 duration-300 rounded-[1.5rem] sm:rounded-[2rem]",
                    selectedRuleId === rule.id ? "border-primary bg-primary/5 shadow-xl shadow-primary/5" : "hover:border-primary/20 border-slate-100"
                  )}>
                    <CardHeader className="pb-3 sm:pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <div className={cn(
                            "p-2.5 sm:p-3 rounded-xl sm:rounded-2xl transition-all shrink-0", 
                            selectedRuleId === rule.id ? "bg-primary text-white shadow-lg shadow-primary/30" : "bg-slate-100 text-slate-500"
                          )}>
                            {rule.icon}
                          </div>
                          <CardTitle className="text-base sm:text-lg font-black truncate">{rule.name}</CardTitle>
                        </div>
                        <Badge variant="secondary" className="text-[9px] sm:text-[10px] font-bold px-2 rounded-full shrink-0">系统预设</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-[12px] text-slate-600 leading-relaxed font-medium line-clamp-4 bg-white/50 p-3 sm:p-4 rounded-xl sm:rounded-2xl prose prose-sm max-w-none">
                        {rule.content}
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant={selectedRuleId === rule.id ? "default" : "outline"} 
                        className="w-full h-10 sm:h-11 rounded-xl font-bold tracking-wide"
                        onClick={() => setSelectedRuleId(rule.id)}
                      >
                        {selectedRuleId === rule.id ? "当前正在应用" : "启用此策略"}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </main>
      
      <style jsx global>{`
        @keyframes progress-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .animate-progress-scan {
          animation: progress-scan 2s infinite linear;
        }
        .prose table {
          @apply w-full border-collapse border border-slate-200 dark:border-slate-800 text-[13px] sm:text-sm my-4;
        }
        .prose th, .prose td {
          @apply border border-slate-200 dark:border-slate-800 p-2 text-left;
        }
        .prose th {
          @apply bg-slate-50 dark:bg-slate-900 font-bold;
        }
        .prose {
          max-width: 100% !important;
        }
      `}</style>
    </div>
  );
}
