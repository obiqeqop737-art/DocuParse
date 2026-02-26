
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
  Check
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
  { id: '1', name: '全能解析', content: '提取文档的关键技术参数、主要结论、潜在风险以及改进建议。' },
  { id: '2', name: '合规审查', content: '检查文档内容是否符合工厂安全生产规范及环境排放标准。' },
  { id: '3', name: '故障诊断', content: '针对文档中描述的现象，识别可能的设备故障根因并给出维修策略。' }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  
  // 规则管理
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
          content = `[加密或非文本文件: ${file.name}] 系统检测到该文件为工厂受控格式，请确保在解密流中操作。目前仅模拟其文本。`;
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
        userQuery: "请根据当前解析规则对该文档进行初步分析并给出摘要。",
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
      toast({ variant: "destructive", title: "自动解析失败", description: error.message });
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
    const rule: Rule = { id: Date.now().toString(), ...newRule };
    setRules([...rules, rule]);
    setNewRule({ name: '', content: '' });
    setIsAddingRule(false);
    toast({ title: "规则已添加", description: `规则 "${rule.name}" 现已可用。` });
  };

  return (
    <div className="flex h-screen bg-neutral-100 overflow-hidden font-body text-neutral-900">
      {/* 侧边导航 */}
      <aside className="w-64 bg-white border-r flex flex-col shadow-sm">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-primary text-white p-2 rounded-xl">
            <BookOpen size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">DocuParse Pro</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-2 mb-2">功能模块</div>
          <Button 
            variant={activeTab === 'documents' ? 'secondary' : 'ghost'} 
            className={cn("w-full justify-start gap-3 rounded-lg", activeTab === 'documents' && "bg-primary/5 text-primary hover:bg-primary/10")}
            onClick={() => setActiveTab('documents')}
          >
            <FileText size={18} /> 文档对话
          </Button>
          <Button 
            variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
            className={cn("w-full justify-start gap-3 rounded-lg", activeTab === 'rules' && "bg-primary/5 text-primary hover:bg-primary/10")}
            onClick={() => setActiveTab('rules')}
          >
            <Settings size={18} /> 规则库管理
          </Button>

          <div className="pt-6">
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-2 mb-4">当前挂载规则</div>
            <div className="space-y-1">
              {rules.map(rule => (
                <div 
                  key={rule.id}
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm cursor-pointer transition-all flex items-center justify-between group",
                    selectedRuleId === rule.id ? "bg-neutral-100 font-semibold" : "hover:bg-neutral-50"
                  )}
                >
                  <span className="truncate">{rule.name}</span>
                  {selectedRuleId === rule.id && <Check size={14} className="text-primary" />}
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t mt-auto">
          <label className="cursor-pointer group block">
            <div className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-3 rounded-xl transition-all shadow-md">
              <Upload size={18} /> <span className="font-medium">上传新文档</span>
            </div>
            <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx" />
          </label>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 bg-white m-2 rounded-2xl border shadow-sm overflow-hidden">
        {activeTab === 'documents' && (
          <div className="flex-1 flex overflow-hidden">
            {/* 文档目录 */}
            <div className="w-80 border-r bg-neutral-50/30 flex flex-col">
              <header className="p-4 border-b bg-white/50 backdrop-blur-md sticky top-0 z-10">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <Input placeholder="搜索文档历史..." className="pl-9 h-9 text-xs bg-white border-neutral-200" />
                </div>
              </header>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {documents.length === 0 ? (
                    <div className="text-center py-20 opacity-30 px-6">
                      <FileSearch className="mx-auto mb-4" size={40} />
                      <p className="text-xs">暂无上传文档，快去上传一份开启对话吧</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <div 
                        key={doc.id} 
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "p-4 rounded-xl border transition-all cursor-pointer relative group",
                          selectedDocId === doc.id ? "border-primary bg-white shadow-md ring-1 ring-primary/10" : "hover:bg-white border-transparent bg-neutral-100/50"
                        )}
                      >
                        <div className="flex items-center gap-3 mb-1">
                          <div className={cn("p-2 rounded-lg", selectedDocId === doc.id ? "bg-primary text-white" : "bg-neutral-200 text-neutral-500")}>
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-xs truncate">{doc.name}</p>
                            <p className="text-[10px] text-neutral-400">{doc.date}</p>
                          </div>
                        </div>
                        {doc.status === 'processing' && (
                          <div className="mt-2 flex items-center gap-2 text-[10px] text-primary">
                            <Loader2 size={10} className="animate-spin" /> 正在根据规则初始解析...
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
                  <header className="h-16 px-6 border-b flex items-center justify-between bg-white z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <div>
                        <h2 className="text-sm font-bold">{selectedDoc.name}</h2>
                        <p className="text-[10px] text-neutral-400">正在应用规则：{activeRule.name}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => {
                      setDocuments(prev => prev.filter(d => d.id !== selectedDoc.id));
                      setSelectedDocId(null);
                    }}>
                      <Trash2 size={14} className="text-neutral-400 hover:text-red-500" />
                    </Button>
                  </header>

                  <ScrollArea className="flex-1 p-6" ref={scrollRef}>
                    <div className="max-w-3xl mx-auto space-y-6">
                      {selectedDoc.chatHistory.map((msg, i) => (
                        <div key={i} className={cn("flex items-start gap-4", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                            msg.role === 'user' ? "bg-neutral-200" : "bg-primary text-white"
                          )}>
                            {msg.role === 'user' ? '我' : <Sparkles size={14} />}
                          </div>
                          <div className={cn(
                            "max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed",
                            msg.role === 'user' ? "bg-neutral-100 text-neutral-800 rounded-tr-none" : "bg-white border shadow-sm rounded-tl-none text-neutral-700"
                          )}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {isChatting && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                            <Sparkles size={14} />
                          </div>
                          <div className="bg-white border p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            <span className="text-xs text-neutral-400 italic font-medium">AI 正在深度研读文档...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <footer className="p-6 bg-white border-t">
                    <div className="max-w-3xl mx-auto flex gap-3 relative">
                      <Textarea 
                        placeholder="在此询问关于文档的任何问题..." 
                        className="min-h-[50px] max-h-[200px] resize-none py-4 pr-14 rounded-2xl bg-neutral-50 border-neutral-200 focus-visible:ring-primary/20"
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
                        className="absolute right-2 bottom-2 h-10 w-10 rounded-xl" 
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isChatting || selectedDoc.status === 'processing'}
                      >
                        <Send size={18} />
                      </Button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-neutral-300">
                  <div className="p-10 bg-neutral-50 rounded-full mb-6">
                    <MessageSquare size={80} className="opacity-10" />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-400">开启你的技术文档对话</h3>
                  <p className="text-sm mt-2">上传文件或从左侧历史中选择一个文档开始分析</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="flex-1 p-8 max-w-4xl mx-auto w-full">
            <header className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-bold">后台解析规则管理</h3>
                <p className="text-neutral-500 text-sm mt-1">定义的规则将作为 System Prompt 注入 AI，指导其分析维度。</p>
              </div>
              <Button onClick={() => setIsAddingRule(true)} className="gap-2">
                <PlusCircle size={18} /> 新增规则
              </Button>
            </header>

            <div className="grid md:grid-cols-2 gap-6">
              {rules.map(rule => (
                <Card key={rule.id} className={cn(
                  "border-2 transition-all group relative overflow-hidden",
                  selectedRuleId === rule.id ? "border-primary bg-primary/5" : "hover:border-neutral-300"
                )}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                         {rule.name}
                         {selectedRuleId === rule.id && <Badge className="bg-primary">当前挂载</Badge>}
                      </CardTitle>
                      {rule.id !== '1' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-400 hover:text-red-500" onClick={() => setRules(rules.filter(r => r.id !== rule.id))}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-neutral-600 leading-relaxed bg-white/50 p-3 rounded-lg border italic">
                      “{rule.content}”
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button 
                      variant={selectedRuleId === rule.id ? "default" : "outline"} 
                      className="w-full text-xs"
                      onClick={() => setSelectedRuleId(rule.id)}
                    >
                      {selectedRuleId === rule.id ? "已选择该规则" : "切换到此规则"}
                    </Button>
                  </CardFooter>
                </Card>
              ))}

              {isAddingRule && (
                <Card className="border-2 border-dashed border-primary bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-base text-primary">定义新规则</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold uppercase">规则名称</Label>
                      <Input 
                        placeholder="例如：备件寿命预测" 
                        value={newRule.name}
                        onChange={e => setNewRule({...newRule, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold uppercase">Prompt 指令内容</Label>
                      <Textarea 
                        placeholder="告知 AI 应该关注文档中的哪些细节..." 
                        rows={4}
                        value={newRule.content}
                        onChange={e => setNewRule({...newRule, content: e.target.value})}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={() => setIsAddingRule(false)}>取消</Button>
                    <Button className="flex-1" onClick={addRule}>确认添加</Button>
                  </CardFooter>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
