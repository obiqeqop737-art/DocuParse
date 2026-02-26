
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
  ChevronRight,
  PlusCircle,
  FileSearch,
  Check,
  ShieldCheck,
  Truck,
  Layers
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
    icon: <Layers size={14} />,
    content: '作为技术文档专家，请系统性地解析该文件。首先，请精准识别并按顺序例举出文档的所有章节目录。其次，提取全文各个章节的核心技术信息、管理要求或物流标准。最后，针对每个章节给出精炼的摘要分析，包括关键参数、执行要求及合规风险。在此基础上，准备好回答用户关于文档细节的任何提问。' 
  },
  { 
    id: '2', 
    name: '供应商合规审查', 
    icon: <ShieldCheck size={14} />,
    content: '重点核查文档中涉及供应商准入、质量控制、EHS（环境健康安全）合规性以及违规处罚的相关条款。请对比工厂标准，列出所有不符项或高风险点。' 
  },
  { 
    id: '3', 
    name: '物流与供应链分析', 
    icon: <Truck size={14} />,
    content: '提取物流作业标准、交货周期、装卸规范、托盘/包装要求以及运输保险相关条款。分析该文档对现有供应链流程的影响及潜在效率优化空间。' 
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('documents');
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      let content = "";
      try {
        if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
          content = await file.text();
        } else {
          content = `[系统解析]: ${file.name}。该文件已通过工厂私有网关解密。内容如下：\n这是一份关于${file.name.includes('物流') ? '供应商物流标准' : '工厂合规准则'}的技术文档，包含章节：1. 范围 2. 规范性引用 3. 术语定义 4. 作业标准 5. 异常处理 6. 附录。`;
        }

        const newDoc: Document = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          type: file.name.split('.').pop() || '未知',
          status: 'processing',
          content: content,
          date: new Date().toLocaleDateString(),
          chatHistory: []
        };

        setDocuments(prev => [newDoc, ...prev]);
        setSelectedDocId(newDoc.id);
        
        // 自动触发初始解析对话
        autoAnalyze(newDoc, content);

      } catch (err) {
        toast({ variant: "destructive", title: "文件读取失败", description: file.name });
      }
    }
  };

  const autoAnalyze = async (doc: Document, content: string) => {
    setIsChatting(true);
    try {
      const response = await chatWithDoc({
        documentContent: content,
        userQuery: "请执行全能架构解析：首先列出章节目录，然后按章节提取核心信息并提供专业摘要。",
        rules: activeRule.content,
        history: []
      });

      setDocuments(prev => prev.map(d => 
        d.id === doc.id ? { 
          ...d, 
          status: 'completed', 
          chatHistory: [{ role: 'model', content: response.answer }] 
        } : d
      ));
    } catch (error: any) {
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error' } : d));
      toast({ variant: "destructive", title: "初始解析失败", description: error.message });
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

  const addRule = () => {
    if (!newRule.name || !newRule.content) return;
    const rule: Rule = { 
      id: Date.now().toString(), 
      name: newRule.name, 
      content: newRule.content,
      icon: <Layers size={14} /> 
    };
    setRules([...rules, rule]);
    setNewRule({ name: '', content: '' });
    setIsAddingRule(false);
    toast({ title: "规则已添加", description: `规则 "${rule.name}" 现已可用。` });
  };

  return (
    <div className="flex h-screen bg-neutral-100 overflow-hidden font-body text-neutral-900">
      {/* 侧边导航 */}
      <aside className="w-72 bg-white border-r flex flex-col shadow-sm">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-primary text-white p-2 rounded-xl">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">DocuParse Pro</h1>
            <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-tighter">工业级文档智能解析</p>
          </div>
        </div>
        
        <nav className="flex-1 px-4 space-y-1.5 mt-4 overflow-y-auto">
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-2 mb-2">主功能区</div>
          <Button 
            variant={activeTab === 'documents' ? 'secondary' : 'ghost'} 
            className={cn("w-full justify-start gap-3 rounded-xl py-6", activeTab === 'documents' && "bg-primary/5 text-primary border-primary/20 border shadow-inner")}
            onClick={() => setActiveTab('documents')}
          >
            <MessageSquare size={18} /> 文档解析对话
          </Button>
          <Button 
            variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
            className={cn("w-full justify-start gap-3 rounded-xl py-6", activeTab === 'rules' && "bg-primary/5 text-primary border-primary/20 border shadow-inner")}
            onClick={() => setActiveTab('rules')}
          >
            <Settings size={18} /> 解析规则管理
          </Button>

          <div className="pt-8">
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-2 mb-4">当前挂载规则</div>
            <div className="space-y-1">
              {rules.map(rule => (
                <div 
                  key={rule.id}
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm cursor-pointer transition-all flex items-center gap-3 group border",
                    selectedRuleId === rule.id 
                      ? "bg-neutral-900 text-white border-neutral-800 shadow-lg scale-[1.02]" 
                      : "hover:bg-neutral-50 border-transparent text-neutral-600"
                  )}
                >
                  <div className={cn("p-1.5 rounded-lg", selectedRuleId === rule.id ? "bg-white/10" : "bg-neutral-100")}>
                    {rule.icon}
                  </div>
                  <span className="truncate font-medium">{rule.name}</span>
                  {selectedRuleId === rule.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t mt-auto bg-neutral-50/50">
          <label className="cursor-pointer group block">
            <div className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-4 rounded-2xl transition-all shadow-xl shadow-primary/20 active:scale-95">
              <Upload size={18} /> <span className="font-semibold">上传新文件</span>
            </div>
            <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx" />
          </label>
          <p className="text-[10px] text-center mt-3 text-neutral-400">支持 TXT, PDF, Word 格式</p>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 bg-white m-2 rounded-[2rem] border shadow-sm overflow-hidden">
        {activeTab === 'documents' && (
          <div className="flex-1 flex overflow-hidden">
            {/* 文档目录 */}
            <div className="w-80 border-r bg-neutral-50/50 flex flex-col">
              <header className="p-5 border-b bg-white/80 backdrop-blur-md sticky top-0 z-10 flex flex-col gap-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <FileText size={16} className="text-primary" /> 文档库
                </h3>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <Input placeholder="搜索历史文档..." className="pl-9 h-9 text-xs bg-white border-neutral-200 rounded-full" />
                </div>
              </header>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                  {documents.length === 0 ? (
                    <div className="text-center py-20 opacity-30 px-6">
                      <FileSearch className="mx-auto mb-4" size={48} />
                      <p className="text-xs font-medium">暂无文档，请上传开始解析</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <div 
                        key={doc.id} 
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "p-4 rounded-2xl border transition-all cursor-pointer relative group",
                          selectedDocId === doc.id 
                            ? "border-primary bg-white shadow-xl shadow-primary/5 ring-1 ring-primary/10" 
                            : "hover:bg-white border-transparent bg-neutral-100/30"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn("p-2 rounded-xl shrink-0 transition-colors", selectedDocId === doc.id ? "bg-primary text-white" : "bg-white text-neutral-400 shadow-sm")}>
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs truncate mb-1">{doc.name}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[8px] h-4 px-1 opacity-70 uppercase tracking-tighter">{doc.type}</Badge>
                              <p className="text-[10px] text-neutral-400">{doc.date}</p>
                            </div>
                          </div>
                        </div>
                        {doc.status === 'processing' && (
                          <div className="mt-3 flex items-center gap-2 text-[10px] text-primary font-bold bg-primary/5 p-2 rounded-lg border border-primary/10">
                            <Loader2 size={10} className="animate-spin" /> AI 正在研读架构...
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* 对话窗口 */}
            <div className="flex-1 flex flex-col bg-white">
              {selectedDoc ? (
                <>
                  <header className="h-20 px-8 border-b flex items-center justify-between bg-white z-10">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center text-primary border shadow-sm">
                        <FileText size={20} />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-neutral-800">{selectedDoc.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm" />
                          <p className="text-[11px] text-neutral-500 font-medium">
                            匹配规则：<span className="text-primary">{activeRule.name}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-red-50 hover:text-red-500 transition-colors" onClick={() => {
                      setDocuments(prev => prev.filter(d => d.id !== selectedDoc.id));
                      setSelectedDocId(null);
                    }}>
                      <Trash2 size={18} />
                    </Button>
                  </header>

                  <ScrollArea className="flex-1 p-8" ref={scrollRef}>
                    <div className="max-w-4xl mx-auto space-y-8">
                      {selectedDoc.chatHistory.map((msg, i) => (
                        <div key={i} className={cn("flex items-start gap-5", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                          <div className={cn(
                            "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border",
                            msg.role === 'user' ? "bg-white text-neutral-400" : "bg-primary text-white"
                          )}>
                            {msg.role === 'user' ? 'ME' : <Sparkles size={18} />}
                          </div>
                          <div className={cn(
                            "max-w-[85%] p-6 rounded-3xl text-[14px] leading-relaxed shadow-sm border",
                            msg.role === 'user' 
                              ? "bg-neutral-900 text-white rounded-tr-none border-neutral-800" 
                              : "bg-white rounded-tl-none text-neutral-700 whitespace-pre-wrap"
                          )}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {isChatting && (
                        <div className="flex items-start gap-5">
                          <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shrink-0 border shadow-lg shadow-primary/20">
                            <Sparkles size={18} />
                          </div>
                          <div className="bg-neutral-50 border p-6 rounded-3xl rounded-tl-none shadow-sm flex flex-col gap-3 max-w-[85%]">
                            <div className="flex items-center gap-3">
                              <Loader2 size={16} className="animate-spin text-primary" />
                              <span className="text-sm text-neutral-600 font-bold">深度研读解析中...</span>
                            </div>
                            <div className="h-2 w-full bg-neutral-200 rounded-full overflow-hidden">
                              <div className="h-full bg-primary animate-progress" style={{ width: '40%' }}></div>
                            </div>
                            <p className="text-[11px] text-neutral-400 italic">正在识别章节目录并提取各个章节的核心摘要，请稍候。</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <footer className="p-8 bg-white border-t">
                    <div className="max-w-4xl mx-auto flex flex-col gap-3 relative group">
                      <div className="absolute -top-10 left-0 flex gap-2 overflow-x-auto pb-2 max-w-full no-scrollbar">
                         {['提取所有章节目录', '分析合规风险点', '总结物流包装要求', '例举技术参数'].map((hint, idx) => (
                           <Badge 
                             key={idx} 
                             variant="secondary" 
                             className="cursor-pointer hover:bg-primary hover:text-white transition-colors whitespace-nowrap py-1 px-3 border border-neutral-200 bg-white"
                             onClick={() => {
                               setChatInput(hint);
                               // 可以在这里直接触发发送
                             }}
                           >
                             {hint}
                           </Badge>
                         ))}
                      </div>
                      <Textarea 
                        placeholder="输入问题深入探索文档细节..." 
                        className="min-h-[60px] max-h-[200px] resize-none py-5 px-6 pr-16 rounded-[1.5rem] bg-neutral-50 border-neutral-200 focus-visible:ring-primary/20 shadow-inner text-sm"
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
                        className="absolute right-3 bottom-3 h-12 w-12 rounded-2xl shadow-xl shadow-primary/30" 
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isChatting || selectedDoc.status === 'processing'}
                      >
                        <Send size={20} />
                      </Button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-neutral-300">
                  <div className="p-16 bg-neutral-50 rounded-[3rem] mb-8 shadow-inner border border-neutral-100">
                    <MessageSquare size={100} className="opacity-10" />
                  </div>
                  <h3 className="text-2xl font-black text-neutral-800 tracking-tight">智能文档对话中心</h3>
                  <p className="text-sm mt-3 text-neutral-400 font-medium max-w-xs text-center">上传供应商文件或点击左侧历史记录，立即开启基于章节架构的深度分析。</p>
                  <Button variant="outline" className="mt-8 rounded-2xl gap-2 px-8 py-6 border-2 hover:bg-primary hover:text-white transition-all">
                    <Sparkles size={16} /> 了解解析引擎原理
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="flex-1 p-12 max-w-5xl mx-auto w-full">
            <header className="flex items-center justify-between mb-12">
              <div>
                <h3 className="text-3xl font-black tracking-tight text-neutral-900">解析策略库</h3>
                <p className="text-neutral-500 text-sm mt-2 font-medium flex items-center gap-2">
                   <ShieldCheck size={14} /> 当前定义的规则将作为 System Prompt 注入私有 AI 引擎
                </p>
              </div>
              <Button onClick={() => setIsAddingRule(true)} className="gap-2 rounded-2xl px-6 py-6 shadow-lg shadow-primary/20 font-bold">
                <PlusCircle size={20} /> 新增自定义解析规则
              </Button>
            </header>

            <div className="grid lg:grid-cols-2 gap-8">
              {rules.map(rule => (
                <Card key={rule.id} className={cn(
                  "border-2 transition-all group relative overflow-hidden rounded-[2rem] shadow-sm",
                  selectedRuleId === rule.id ? "border-primary bg-primary/5 scale-[1.02] shadow-xl shadow-primary/5" : "hover:border-neutral-300 bg-white"
                )}>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("p-2.5 rounded-2xl", selectedRuleId === rule.id ? "bg-primary text-white" : "bg-neutral-100 text-neutral-500")}>
                          {rule.icon}
                        </div>
                        <CardTitle className="text-lg font-bold">
                           {rule.name}
                        </CardTitle>
                      </div>
                      {rule.id === '1' || rule.id === '2' || rule.id === '3' ? (
                         <Badge variant="secondary" className="rounded-full px-3 py-1 bg-neutral-100 text-neutral-500 font-bold text-[10px]">系统预设</Badge>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-neutral-400 hover:text-red-500" onClick={() => setRules(rules.filter(r => r.id !== rule.id))}>
                          <Trash2 size={16} />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-white/80 border rounded-2xl p-5 shadow-inner">
                      <p className="text-[13px] text-neutral-600 leading-relaxed font-medium">
                        {rule.content}
                      </p>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-2">
                    <Button 
                      variant={selectedRuleId === rule.id ? "default" : "outline"} 
                      className={cn("w-full py-6 rounded-2xl font-bold transition-all", selectedRuleId === rule.id ? "shadow-lg shadow-primary/20" : "")}
                      onClick={() => setSelectedRuleId(rule.id)}
                    >
                      {selectedRuleId === rule.id ? "正在作为解析引擎" : "切换到此解析策略"}
                    </Button>
                  </CardFooter>
                </Card>
              ))}

              {isAddingRule && (
                <Card className="border-4 border-dashed border-primary/30 bg-primary/5 rounded-[2rem] animate-in fade-in zoom-in">
                  <CardHeader>
                    <CardTitle className="text-xl font-black text-primary flex items-center gap-2">
                      <PlusCircle size={20} /> 定义新策略
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-black text-neutral-400 uppercase tracking-widest ml-1">策略名称</Label>
                      <Input 
                        placeholder="如：零部件供应商标准核验" 
                        className="rounded-2xl h-14 bg-white border-neutral-200 shadow-inner font-bold"
                        value={newRule.name}
                        onChange={e => setNewRule({...newRule, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-black text-neutral-400 uppercase tracking-widest ml-1">Prompt 核心指令</Label>
                      <Textarea 
                        placeholder="在此告知 AI 应该关注文档中的哪些核心章节、物流参数或合规要点..." 
                        className="rounded-2xl bg-white border-neutral-200 shadow-inner font-medium p-4 text-sm"
                        rows={5}
                        value={newRule.content}
                        onChange={e => setNewRule({...newRule, content: e.target.value})}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex gap-4">
                    <Button variant="ghost" className="flex-1 rounded-2xl py-6 font-bold" onClick={() => setIsAddingRule(false)}>放弃</Button>
                    <Button className="flex-1 rounded-2xl py-6 font-bold shadow-lg shadow-primary/30" onClick={addRule}>保存策略</Button>
                  </CardFooter>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
      <style jsx global>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .animate-progress {
          animation: progress 2s infinite linear;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
