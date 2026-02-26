
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
  FileDown
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { chatWithDoc } from '@/ai/flows/chat-with-doc-flow';
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

// 动态导入 pdfjs
import * as pdfjsLib from 'pdfjs-dist';

// 配置 PDF.js Worker
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
  status: 'processing' | 'completed' | 'error';
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
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(DEFAULT_RULES[0].id);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', content: '' });

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules[0];
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedDoc?.chatHistory, isChatting]);

  // PDF 文本提取函数
  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += `\n\n--- 第 ${i} 页 ---\n\n${pageText}`;
    }
    
    return fullText;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const fileId = Math.random().toString(36).substring(2, 9);
      
      try {
        let text = '';
        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        // 创建初始文档对象
        const newDoc: Document = {
          id: fileId,
          name: file.name,
          type: fileExtension?.toUpperCase() || 'UNKNOWN',
          status: 'processing',
          content: '',
          date: new Date().toLocaleDateString(),
          chatHistory: []
        };

        setDocuments(prev => [newDoc, ...prev]);
        setSelectedDocId(fileId);

        if (fileExtension === 'pdf') {
          text = await extractTextFromPDF(file);
        } else {
          text = await file.text();
        }

        const markdownContent = `\n\`\`\`markdown\n# 文档名: ${file.name}\n\n${text}\n\`\`\`\n`;
        
        setDocuments(prev => prev.map(d => d.id === fileId ? { ...d, content: markdownContent } : d));
        autoAnalyze(fileId, markdownContent);

      } catch (err: any) {
        setDocuments(prev => prev.filter(d => d.id !== fileId));
        toast({ 
          variant: "destructive", 
          title: "文件读取失败", 
          description: err.message || file.name 
        });
      }
    }
  };

  const autoAnalyze = async (docId: string, content: string) => {
    setIsChatting(true);
    try {
      const response = await chatWithDoc({
        documentContent: content,
        userQuery: "请执行解析策略：识别全文章节目录并提取各章节摘要。",
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
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
      toast({ variant: "destructive", title: "深度研读失败", description: error.message });
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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      <div className="p-6 flex items-center gap-3">
        <div className="bg-primary text-primary-foreground p-2 rounded-lg shadow-lg shadow-primary/20">
          <BookOpen size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">DocuParse Pro</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Technical Document AI</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        <Button 
          variant={activeTab === 'chat' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11 rounded-xl"
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={18} /> 文档对话
        </Button>
        <Button 
          variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11 rounded-xl"
          onClick={() => setActiveTab('rules')}
        >
          <Settings size={18} /> 解析规则库
        </Button>

        <div className="mt-8 mb-2 px-3 flex items-center justify-between">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">活跃解析策略</p>
        </div>
        {rules.map(rule => (
          <button 
            key={rule.id}
            onClick={() => setSelectedRuleId(rule.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left",
              selectedRuleId === rule.id 
                ? "bg-primary/10 text-primary font-semibold ring-1 ring-primary/20" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {rule.icon}
            <span className="truncate">{rule.name}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t bg-muted/20">
        <label className="w-full cursor-pointer flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-3.5 rounded-2xl transition-all shadow-lg shadow-primary/30 active:scale-[0.98]">
          <Upload size={18} /> <span className="text-sm font-bold tracking-wide">上传 PDF/TXT</span>
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf" />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-muted/30 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col border-r transition-all duration-300 bg-white dark:bg-slate-900",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>
        <NavContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Header Bar */}
        <header className="h-16 px-6 border-b flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
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
              className="hidden md:flex text-muted-foreground hover:text-primary" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <ChevronLeft size={20} className={cn("transition-transform", !isSidebarOpen && "rotate-180")} />
            </Button>
            <div className="flex items-center gap-3">
              <span className="font-extrabold text-sm hidden sm:inline-block tracking-tight text-slate-700 dark:text-slate-200">
                {activeTab === 'chat' ? '文档智能终端' : '解析策略配置'}
              </span>
              {selectedDoc && activeTab === 'chat' && (
                <Badge variant="outline" className="hidden sm:inline-flex bg-primary/5 text-primary border-primary/20 rounded-lg py-1 px-3">
                  <FileText size={12} className="mr-1.5" />
                  {selectedDoc.name}
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2.5 px-4 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">DeepSeek-V3 活跃</span>
            </div>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Document Library */}
            <div className={cn(
              "w-full md:w-72 border-r bg-slate-50/50 dark:bg-slate-900/50 flex flex-col",
              selectedDocId ? "hidden md:flex" : "flex"
            )}>
              <div className="p-4 border-b bg-white dark:bg-slate-900">
                <div className="relative">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="检索历史文档..." className="pl-10 h-10 text-xs rounded-xl bg-muted/40 border-none focus-visible:ring-primary/30" />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2.5">
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
                          "w-full p-3.5 rounded-2xl border text-left transition-all duration-200 group",
                          selectedDocId === doc.id 
                            ? "border-primary bg-white dark:bg-slate-800 shadow-xl shadow-primary/5 ring-1 ring-primary/20" 
                            : "hover:bg-white dark:hover:bg-slate-800 border-transparent bg-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-2.5 rounded-xl transition-colors", 
                            selectedDocId === doc.id ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          )}>
                            {doc.type === 'PDF' ? <FileDown size={18} /> : <FileText size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[13px] truncate text-slate-800 dark:text-slate-200">{doc.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{doc.date} • {doc.type}</p>
                          </div>
                        </div>
                        {doc.status === 'processing' && (
                          <div className="mt-3 flex items-center gap-2.5 text-[10px] text-primary font-bold bg-primary/5 p-2 rounded-lg border border-primary/10">
                            <Loader2 size={12} className="animate-spin" /> 正在研读文档结构...
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Chat Area */}
            <div className={cn(
              "flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-hidden",
              !selectedDocId && "hidden md:flex"
            )}>
              {selectedDoc ? (
                <>
                  <ScrollArea className="flex-1 px-4 md:px-12 py-8" ref={scrollRef}>
                    <div className="max-w-4xl mx-auto space-y-8">
                      {selectedDoc.chatHistory.map((msg, i) => (
                        <div key={i} className={cn("flex gap-5", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
                            msg.role === 'user' ? "bg-slate-100 dark:bg-slate-800" : "bg-primary text-primary-foreground shadow-primary/20"
                          )}>
                            {msg.role === 'user' ? <span className="text-xs font-bold">用户</span> : <Sparkles size={18} />}
                          </div>
                          <div className={cn(
                            "max-w-[85%] p-5 rounded-3xl text-[14px] leading-relaxed shadow-sm transition-all",
                            msg.role === 'user' 
                              ? "bg-primary text-primary-foreground rounded-tr-none" 
                              : "bg-slate-50 dark:bg-slate-900 border rounded-tl-none text-foreground whitespace-pre-wrap"
                          )}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {isChatting && (
                        <div className="flex gap-5">
                          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                            <Sparkles size={18} />
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900 border p-5 rounded-3xl rounded-tl-none shadow-sm flex flex-col gap-3 max-w-[85%] animate-in fade-in slide-in-from-left-2">
                            <div className="flex items-center gap-3">
                              <Loader2 size={16} className="animate-spin text-primary" />
                              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300">DeepSeek-V3 正在研读中...</span>
                            </div>
                            <div className="h-1.5 w-48 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-primary animate-progress-scan w-1/3 rounded-full" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <footer className="p-6 md:p-8 border-t bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl">
                    <div className="max-w-4xl mx-auto flex flex-col gap-4">
                      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                         {['提取核心目录', '分析合规风险点', '总结物流装卸标准', '识别核心技术参数', '核查准入条款'].map((hint, idx) => (
                           <Badge 
                             key={idx} 
                             variant="secondary" 
                             className="cursor-pointer hover:bg-primary hover:text-white transition-all whitespace-nowrap py-2 px-4 rounded-full border-none bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-400 active:scale-95"
                             onClick={() => setChatInput(hint)}
                           >
                             {hint}
                           </Badge>
                         ))}
                      </div>
                      <div className="relative group">
                        <Textarea 
                          placeholder="输入您的问题 (DeepSeek-V3 已挂载文档全文)..." 
                          className="min-h-[60px] max-h-[200px] resize-none py-5 px-6 pr-16 rounded-3xl bg-slate-50 dark:bg-slate-900/50 border-none focus-visible:ring-primary/20 text-[14px] shadow-inner"
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
                          className="absolute right-3 bottom-3 h-12 w-12 rounded-2xl shadow-lg shadow-primary/30 transition-transform active:scale-90" 
                          onClick={handleSendMessage}
                          disabled={!chatInput.trim() || isChatting || selectedDoc.status === 'processing'}
                        >
                          <Send size={20} />
                        </Button>
                      </div>
                      <p className="text-[10px] text-center text-muted-foreground font-medium">所有文档数据将通过硅基流动 API 加密处理，符合工厂 EHS 安全规范</p>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50/30 dark:bg-slate-950/30">
                  <div className="w-24 h-24 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl shadow-primary/10 flex items-center justify-center mb-8 border border-slate-100 dark:border-slate-800">
                    <MessageSquare size={40} className="text-primary/40" />
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100">开始您的智能解析</h3>
                  <p className="text-sm text-muted-foreground mt-3 max-w-sm leading-relaxed font-medium">
                    请在左侧选择已有文档或上传新的 PDF/TXT 技术规范。DeepSeek-V3 引擎将为您提供深度解析与实时问答支持。
                  </p>
                  <Button variant="outline" className="mt-10 rounded-2xl px-10 py-7 h-auto border-2 hover:bg-primary hover:text-white hover:border-primary transition-all group" asChild>
                    <label className="cursor-pointer">
                      <Upload className="mr-3 transition-transform group-hover:-translate-y-1" size={20} /> 
                      <span className="font-bold tracking-wide">上传本地文档</span>
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf" />
                    </label>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <ScrollArea className="flex-1 p-6 md:p-12 bg-slate-50/30 dark:bg-slate-950/30">
            <div className="max-w-6xl mx-auto">
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div>
                  <h3 className="text-3xl font-black tracking-tight text-slate-800 dark:text-slate-100">解析策略库</h3>
                  <p className="text-muted-foreground text-sm mt-2 font-medium">
                    定义的策略将作为 System Prompt 注入硅基流动 AI 引擎，指导其分析维度
                  </p>
                </div>
                <Button onClick={() => setIsAddingRule(true)} className="gap-3 rounded-2xl h-12 px-6 shadow-lg shadow-primary/20">
                  <PlusCircle size={20} /> 新增解析策略
                </Button>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {rules.map(rule => (
                  <Card key={rule.id} className={cn(
                    "transition-all border-2 duration-300 rounded-[2rem]",
                    selectedRuleId === rule.id ? "border-primary bg-primary/5 shadow-xl shadow-primary/5" : "hover:border-primary/20 border-slate-100 dark:border-slate-800"
                  )}>
                    <CardHeader className="pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "p-3 rounded-2xl transition-all", 
                            selectedRuleId === rule.id ? "bg-primary text-white shadow-lg shadow-primary/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          )}>
                            {rule.icon}
                          </div>
                          <CardTitle className="text-lg font-black tracking-tight">{rule.name}</CardTitle>
                        </div>
                        {['1','2','3'].includes(rule.id) ? (
                           <Badge variant="secondary" className="text-[10px] font-bold px-2 rounded-full">系统预设</Badge>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-xl" onClick={() => setRules(rules.filter(r => r.id !== rule.id))}>
                            <Trash2 size={16} />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium line-clamp-4 bg-white/50 dark:bg-slate-900/50 p-4 rounded-2xl">
                        {rule.content}
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant={selectedRuleId === rule.id ? "default" : "outline"} 
                        className={cn("w-full h-11 rounded-xl font-bold tracking-wide", selectedRuleId === rule.id ? "shadow-lg shadow-primary/20" : "")}
                        onClick={() => setSelectedRuleId(rule.id)}
                      >
                        {selectedRuleId === rule.id ? "策略已启用" : "切换至此解析策略"}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}

                {isAddingRule && (
                  <Card className="border-primary border-dashed border-2 bg-primary/5 rounded-[2rem] animate-in zoom-in-95">
                    <CardHeader>
                      <CardTitle className="text-lg font-black flex items-center gap-3">
                        <PlusCircle size={20} /> 定义新策略
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-black uppercase text-slate-500 tracking-[0.1em]">策略名称</Label>
                        <Input 
                          placeholder="例如：原材料检验标准" 
                          className="bg-white dark:bg-slate-900 h-12 rounded-xl border-none shadow-inner"
                          value={newRule.name}
                          onChange={e => setNewRule({...newRule, name: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[11px] font-black uppercase text-slate-500 tracking-[0.1em]">核心解析指令 (PROMPT)</Label>
                        <Textarea 
                          placeholder="告知 AI 应该关注文档中的哪些核心要素、特定行业术语或合规风险点..." 
                          className="bg-white dark:bg-slate-900 rounded-2xl border-none shadow-inner py-4"
                          rows={6}
                          value={newRule.content}
                          onChange={e => setNewRule({...newRule, content: e.target.value})}
                        />
                      </div>
                    </CardContent>
                    <CardFooter className="flex gap-3">
                      <Button variant="ghost" className="flex-1 h-12 rounded-xl font-bold" onClick={() => setIsAddingRule(false)}>取消</Button>
                      <Button className="flex-1 h-12 rounded-xl font-bold shadow-lg shadow-primary/20" onClick={() => {
                        if (newRule.name && newRule.content) {
                          setRules([...rules, { ...newRule, id: Date.now().toString(), icon: <Layers size={16} /> }]);
                          setNewRule({ name: '', content: '' });
                          setIsAddingRule(false);
                          toast({ title: "策略保存成功", description: `"${newRule.name}" 已加入策略库。` });
                        }
                      }}>保存策略</Button>
                    </CardFooter>
                  </Card>
                )}
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
      `}</style>
    </div>
  );
}
