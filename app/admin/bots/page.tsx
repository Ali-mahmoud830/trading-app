"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Send,
  ExternalLink,
  Copy,
  Check,
  Users,
  AlertTriangle,
  Zap,
  Activity,
  MessageSquare,
  Lock,
  Radio,
  FileText,
  UserCheck,
  Unlink,
  Trash2,
  PlusCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/language-context";

export interface GroupItem {
  chatId: string;
  title: string;
  type: string;
  botStatus: "administrator" | "creator" | "member" | "restricted" | "left" | "kicked" | "unknown";
  isAdmin: boolean;
  canSendMessages: boolean;
  error?: string;
}

interface BotData {
  configured: boolean;
  botType: "otp" | "group";
  me?: {
    id: number;
    first_name: string;
    username: string;
    can_join_groups: boolean;
  };
  webhook?: {
    url: string;
    isExpectedUrl: boolean;
    pendingUpdateCount: number;
    lastErrorDate: string | null;
    lastErrorMessage: string | null;
    maxConnections: number;
    ipAddress: string | null;
  };
  descriptions?: {
    default: string;
    defaultShort: string;
    ar: string;
    arShort: string;
  };
  tamperCheck?: {
    isTampered: boolean;
    suspiciousUrls: string[];
  };
  anomalies?: string[];
  isHealthy?: boolean;
  error?: string;
}

interface LinkedUser {
  uid: string;
  full_name: string | null;
  email: string | null;
  telegram_chat_id: string | null;
  balance: number;
  status: string | null;
  country: string | null;
  created_at: string;
}

interface BotLog {
  id: string;
  type: string;
  title: string;
  message: string;
  data: any;
  created_at: string;
}

export default function AdminBotsPage() {
  const { t, language } = useLanguage();
  const isAr = language === "ar";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [botsData, setBotsData] = useState<{
    otpBot: BotData | null;
    groupBot: BotData | null;
    stats: { totalLinkedUsers: number; totalNotifications: number };
    hasAnomalies: boolean;
    allAnomalies: string[];
    recentLogs: BotLog[];
  } | null>(null);

  const [users, setUsers] = useState<LinkedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchUser, setSearchUser] = useState("");

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Direct Message Dialog state
  const [msgDialogOpen, setMsgDialogOpen] = useState(false);
  const [msgBotType, setMsgBotType] = useState<"otp" | "group">("otp");
  const [msgTargetChatId, setMsgTargetChatId] = useState("");
  const [msgTargetUserName, setMsgTargetUserName] = useState("");
  const [msgContent, setMsgContent] = useState("");
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [sendingDailySummary, setSendingDailySummary] = useState(false);
  const [sendingTestSignal, setSendingTestSignal] = useState(false);
  const [groupChatIdInput, setGroupChatIdInput] = useState("");
  const [newGroupIdInput, setNewGroupIdInput] = useState("");
  const [connectedGroups, setConnectedGroups] = useState<GroupItem[]>([]);
  const [testingGroupChatId, setTestingGroupChatId] = useState<string | null>(null);
  const [savingGroupId, setSavingGroupId] = useState(false);
  const [detectingGroupId, setDetectingGroupId] = useState(false);

  // Action pending states
  const [actionPending, setActionPending] = useState<string | null>(null);

  const fetchBotStatus = async (showToast = false) => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/admin/bots/status");
      const data = await res.json();
      if (res.ok) {
        setBotsData({
          otpBot: data.bots.otpBot,
          groupBot: data.bots.groupBot,
          stats: data.stats,
          hasAnomalies: data.hasAnomalies,
          allAnomalies: data.allAnomalies,
          recentLogs: data.recentLogs,
        });
        if (showToast) {
          toast.success("Bot status refreshed successfully");
        }
      } else {
        toast.error(data.message || "Failed to load bot status");
      }
    } catch {
      toast.error("Network error while inspecting bots");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchLinkedUsers = async () => {
    try {
      setUsersLoading(true);
      const res = await fetch(`/api/admin/bots/users?search=${encodeURIComponent(searchUser)}`);
      const data = await res.json();
      if (res.ok && data.users) {
        setUsers(data.users);
      }
    } catch {
      toast.error("Failed to load linked users");
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    fetchBotStatus();
    fetchLinkedUsers();
    fetchBotSettings();
    const interval = setInterval(() => {
      fetchBotStatus();
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success("Copied to clipboard");
  };

  const handleBotAction = async (botType: "otp" | "group", action: string, extraBody = {}) => {
    const key = `${botType}_${action}`;
    setActionPending(key);
    try {
      const res = await fetch("/api/admin/bots/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botType, action, ...extraBody }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Action executed successfully");
        await fetchBotStatus();
      } else {
        toast.error(data.message || "Action failed");
      }
    } catch {
      toast.error("Network error during action execution");
    } finally {
      setActionPending(null);
    }
  };

  const handleUnlink = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to unlink Telegram for ${userName}?`)) return;
    try {
      const res = await fetch("/api/admin/bots/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlink_user", userId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("User Telegram unlinked");
        fetchLinkedUsers();
        fetchBotStatus();
      } else {
        toast.error(data.message || "Failed to unlink user");
      }
    } catch {
      toast.error("Network error while unlinking user");
    }
  };

  const handleSendMessageSubmit = async () => {
    if (!msgContent.trim()) {
      toast.error("Message content cannot be empty");
      return;
    }
    setSendingMsg(true);
    try {
      const res = await fetch("/api/admin/bots/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          botType: msgBotType,
          targetChatId: isBroadcasting ? null : msgTargetChatId,
          messageText: msgContent,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (isBroadcasting) {
          toast.success(`Broadcast sent to ${data.successCount} users!`);
        } else {
          toast.success("Message sent successfully!");
        }
        setMsgDialogOpen(false);
        setMsgContent("");
        fetchBotStatus();
      } else {
        toast.error(data.message || "Failed to send message");
      }
    } catch {
      toast.error("Error sending message");
    } finally {
      setSendingMsg(false);
    }
  };

  const fetchBotSettings = async () => {
    try {
      const res = await fetch("/api/admin/bots/settings");
      const data = await res.json();
      if (res.ok) {
        if (data.telegramGroupChatId) {
          setGroupChatIdInput(data.telegramGroupChatId);
        }
        if (data.groups) {
          setConnectedGroups(data.groups);
        }
      }
    } catch {}
  };

  const handleSaveGroupId = async () => {
    if (!groupChatIdInput.trim()) {
      toast.error(isAr ? "يرجى إدخال معرف المجموعة (Group Chat ID)" : "Group Chat ID is required");
      return;
    }
    setSavingGroupId(true);
    try {
      const res = await fetch("/api/admin/bots/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_group_ids", groupChatId: groupChatIdInput }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || (isAr ? "تم حفظ معرف المجموعة بنجاح" : "Group IDs saved successfully"));
        await fetchBotSettings();
      } else {
        toast.error(data.message || (isAr ? "فشل حفظ معرف المجموعة" : "Failed to save group IDs"));
      }
    } catch {
      toast.error(isAr ? "خطأ أثناء الاتصال" : "Network error");
    } finally {
      setSavingGroupId(false);
    }
  };

  const handleTestGroupMessage = async (chatId: string) => {
    setTestingGroupChatId(chatId);
    try {
      const res = await fetch("/api/admin/bots/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_group", chatId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || (isAr ? "تم إرسال رسالة الاختبار بنجاح!" : "Test message sent!"));
      } else {
        toast.error(data.message || (isAr ? "فشل إرسال رسالة الاختبار" : "Failed to send test message"));
      }
    } catch {
      toast.error(isAr ? "خطأ في الاتصال" : "Network error");
    } finally {
      setTestingGroupChatId(null);
    }
  };

  const handleRemoveGroupChat = async (chatId: string) => {
    if (!confirm(isAr ? `هل أنت متأكد من إزالة المجموعة (${chatId}) من قائمة البث؟` : `Remove group (${chatId})?`)) return;
    try {
      const res = await fetch("/api/admin/bots/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_group_id", chatId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || (isAr ? "تمت إزالة المجموعة بنجاح" : "Group removed"));
        await fetchBotSettings();
      } else {
        toast.error(data.message || "Failed to remove group");
      }
    } catch {
      toast.error(isAr ? "خطأ في الحذف" : "Error removing group");
    }
  };

  const handleAddGroupChat = async () => {
    const val = newGroupIdInput.trim();
    if (!val) {
      toast.error(isAr ? "يرجى إدخال معرف المجموعة أو القناة" : "Please enter a Group ID");
      return;
    }
    const combined = groupChatIdInput ? `${groupChatIdInput}, ${val}` : val;
    setGroupChatIdInput(combined);
    setNewGroupIdInput("");
    setSavingGroupId(true);
    try {
      const res = await fetch("/api/admin/bots/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_group_ids", groupChatId: combined }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(isAr ? "تمت إضافة المجموعة وفحص صلاحيات البوت بنجاح!" : "Group added & verified!");
        await fetchBotSettings();
      } else {
        toast.error(data.message || "Failed to save group");
      }
    } catch {
      toast.error(isAr ? "خطأ في الاتصال" : "Connection error");
    } finally {
      setSavingGroupId(false);
    }
  };

  const handleAutoDetectGroupId = async () => {
    setDetectingGroupId(true);
    try {
      const res = await fetch("/api/admin/bots/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto_detect" }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.detectedChatId) {
        setGroupChatIdInput(data.detectedChatId);
        toast.success(data.message || (isAr ? "تم اكتشاف معرف المجموعة وحفظه بنجاح!" : "Group detected & saved!"));
        await fetchBotSettings();
      } else {
        toast.info(data.message || (isAr ? "لم يتم رصد رسالة مجموعة بعد. أضف @XSpyAIBot للمجموعة وأرسل رسالة داخلها." : "No new groups detected."));
      }
    } catch {
      toast.error(isAr ? "خطأ أثناء محاولة الكشف التلقائي" : "Auto-detect error");
    } finally {
      setDetectingGroupId(false);
    }
  };

  const handleSendDailySummary = async () => {
    setSendingDailySummary(true);
    try {
      const res = await fetch("/api/cron/daily-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetChatId: groupChatIdInput.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("تم بث التقرير اليومي بنجاح إلى مجموعة تيليجرام!");
        fetchBotStatus();
      } else {
        toast.error(data.message || data.error || "فشل إرسال التقرير اليومي. تأكد من ضبط معرف المجموعة.");
      }
    } catch {
      toast.error("خطأ في الاتصال أثناء إرسال التقرير");
    } finally {
      setSendingDailySummary(false);
    }
  };

  const handleSendTestSignal = async () => {
    setSendingTestSignal(true);
    try {
      const res = await fetch("/api/admin/bots/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: "EUR/USD",
          duration_sec: 60,
          payout_percent: 3,
          direction: "buy",
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`تم بث إشارة التداول بنجاح إلى ${data.successCount} متداول ${data.groupBroadcast ? "والمجموعة ✅" : ""}`);
        fetchBotStatus();
      } else {
        toast.error(data.error || "فشل بث إشارة التداول");
      }
    } catch {
      toast.error("خطأ في الاتصال أثناء بث الإشارة");
    } finally {
      setSendingTestSignal(false);
    }
  };

  const openDirectMessage = (chatId: string, name: string) => {
    setIsBroadcasting(false);
    setMsgTargetChatId(chatId);
    setMsgTargetUserName(name);
    setMsgBotType("otp");
    setMsgContent("");
    setMsgDialogOpen(true);
  };

  const openBroadcast = (botType: "otp" | "group") => {
    setIsBroadcasting(true);
    setMsgTargetChatId("");
    setMsgTargetUserName("All Linked Users");
    setMsgBotType(botType);
    setMsgContent("");
    setMsgDialogOpen(true);
  };

  const otp = botsData?.otpBot;
  const group = botsData?.groupBot;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto" dir={isAr ? "rtl" : "ltr"}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {isAr ? "مركز تحكم وإدارة بوتات تيليجرام" : "Telegram Bots Command Center"}
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {isAr
                  ? "إدارة ومراقبة أمنية مباشرة وفورية لكافة بوتات تيليجرام التابعة للمنصة"
                  : "Direct real-time management and security oversight of all platform Telegram bots."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchBotStatus(true)}
            disabled={refreshing}
            className="border-gray-300 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin text-blue-500" : ""}`} />
            {refreshing ? (isAr ? "جاري الفحص..." : "Checking...") : isAr ? "فحص وتحديث الحالة" : "Inspect Status"}
          </Button>
          <Button
            size="sm"
            onClick={() => openBroadcast("otp")}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Send className="w-4 h-4 mr-2" />
            {isAr ? "بث رسالة للمشتركين" : "Broadcast Message"}
          </Button>
        </div>
      </div>

      {/* ── Anomaly Alert Banner ─────────────────────────────────────────── */}
      {botsData?.hasAnomalies ? (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-red-300">⚠️ Bot Security Anomaly Detected!</h4>
              <ul className="text-xs text-red-200/90 mt-1 list-disc list-inside space-y-0.5">
                {botsData.allAnomalies.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await handleBotAction("otp", "sanitize_profile");
                await handleBotAction("otp", "resync_webhook");
                await handleBotAction("group", "sanitize_profile");
                await handleBotAction("group", "resync_webhook");
                toast.success("Emergency sanitize & resync applied to both bots!");
              }}
            >
              <Zap className="w-4 h-4 mr-1.5" />
              1-Click Clean & Re-sync All
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>
              <strong>All Bots 100% Secure & Synchronized:</strong> Webhooks active, 0 tampering detected, official branding verified.
            </span>
          </div>
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
            Protected
          </Badge>
        </div>
      )}

      {/* ── Summary Stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Linked Users</p>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {botsData?.stats.totalLinkedUsers ?? "--"}
              </h3>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">2FA OTP Bot</p>
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {otp?.webhook?.isExpectedUrl ? "Active & Sync" : "Needs Re-sync"}
              </h3>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Group AI Bot</p>
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {group?.webhook?.isExpectedUrl ? "Active & Sync" : "Needs Re-sync"}
              </h3>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Security Events</p>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {botsData?.stats.totalNotifications ?? "--"}
              </h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Two Bot Control Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot 1: OTP Bot */}
        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardHeader className="pb-3 border-b border-gray-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                  XS
                </div>
                <div>
                  <CardTitle className="text-base text-gray-900 dark:text-white flex items-center gap-2">
                    {otp?.me?.first_name || "Xspy Trader Security"}
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">
                      2FA & OTP
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs text-blue-400 flex items-center gap-1">
                    @{otp?.me?.username || "XspyTraderOtp_bot"}
                    <a
                      href={`https://t.me/${otp?.me?.username || "XspyTraderOtp_bot"}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline inline-flex items-center"
                    >
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </CardDescription>
                </div>
              </div>
              <Badge
                className={
                  otp?.isHealthy
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-red-500/20 text-red-300 border-red-500/30"
                }
              >
                {otp?.isHealthy ? "Operational" : "Warning"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-4 text-xs">
            {/* Diagnostics */}
            <div className="space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Webhook URL:</span>
                <span className="font-mono text-gray-800 dark:text-slate-200 truncate max-w-[240px]">
                  {otp?.webhook?.url || "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Pending Updates:</span>
                <span className={`font-bold ${otp?.webhook?.pendingUpdateCount ? "text-amber-400" : "text-emerald-400"}`}>
                  {otp?.webhook?.pendingUpdateCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Max Connections:</span>
                <span className="text-gray-700 dark:text-slate-300">{otp?.webhook?.maxConnections ?? 40}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Tamper Inspection:</span>
                <span className={otp?.tamperCheck?.isTampered ? "text-red-400 font-bold" : "text-emerald-400"}>
                  {otp?.tamperCheck?.isTampered ? "Tamper Detected!" : "Verified Clean"}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={actionPending === "otp_resync_webhook"}
                onClick={() => handleBotAction("otp", "resync_webhook")}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${actionPending === "otp_resync_webhook" ? "animate-spin" : ""}`} />
                Re-sync Webhook
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                disabled={actionPending === "otp_sanitize_profile"}
                onClick={() => handleBotAction("otp", "sanitize_profile")}
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                Sanitize Profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={actionPending === "otp_test_ping"}
                onClick={async () => {
                  await handleBotAction("otp", "test_ping");
                }}
              >
                <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                Test Latency
              </Button>
              <Button
                variant="default"
                size="sm"
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => openBroadcast("otp")}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Send Alert
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Bot 2: Group Bot */}
        <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <CardHeader className="pb-3 border-b border-gray-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold">
                  XB
                </div>
                <div>
                  <CardTitle className="text-base text-gray-900 dark:text-white flex items-center gap-2">
                    {group?.me?.first_name || "XSpy AI Bot"}
                    <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
                      AI & Group
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs text-purple-400 flex items-center gap-1">
                    @{group?.me?.username || "XSpyAIBot"}
                    <a
                      href={`https://t.me/${group?.me?.username || "XSpyAIBot"}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline inline-flex items-center"
                    >
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </CardDescription>
                </div>
              </div>
              <Badge
                className={
                  group?.isHealthy
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-red-500/20 text-red-300 border-red-500/30"
                }
              >
                {group?.isHealthy ? "Operational" : "Warning"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-4 text-xs">
            {/* Diagnostics */}
            <div className="space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Webhook URL:</span>
                <span className="font-mono text-gray-800 dark:text-slate-200 truncate max-w-[240px]">
                  {group?.webhook?.url || "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Pending Updates:</span>
                <span className={`font-bold ${group?.webhook?.pendingUpdateCount ? "text-amber-400" : "text-emerald-400"}`}>
                  {group?.webhook?.pendingUpdateCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Intelligence Engine:</span>
                <span className="text-purple-400 font-semibold">Gemini Flash (Multilingual)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-slate-400">Tamper Inspection:</span>
                <span className={group?.tamperCheck?.isTampered ? "text-red-400 font-bold" : "text-emerald-400"}>
                  {group?.tamperCheck?.isTampered ? "Tamper Detected!" : "Verified Clean"}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={actionPending === "group_resync_webhook"}
                onClick={() => handleBotAction("group", "resync_webhook")}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${actionPending === "group_resync_webhook" ? "animate-spin" : ""}`} />
                Re-sync Webhook
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                disabled={actionPending === "group_sanitize_profile"}
                onClick={() => handleBotAction("group", "sanitize_profile")}
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                Sanitize Profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={actionPending === "group_test_ping"}
                onClick={async () => {
                  await handleBotAction("group", "test_ping");
                }}
              >
                <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                Test Latency
              </Button>
              <Button
                variant="default"
                size="sm"
                className="text-xs bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => openBroadcast("group")}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                Group Notice
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs: Connected Users, Security Monitor, Messaging, Logs ─────── */}
      <Tabs defaultValue="broadcast" className="w-full">
        <TabsList className="bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 p-1">
          <TabsTrigger value="broadcast" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
            <Radio className="w-4 h-4 mr-2" />
            {isAr ? "المجموعات والإشارات والبث" : "Groups & Broadcast"}
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
            <Users className="w-4 h-4 mr-2" />
            {isAr ? "المستخدمون المرتبطون" : "Connected Users"} ({botsData?.stats.totalLinkedUsers ?? 0})
          </TabsTrigger>
          <TabsTrigger value="monitor" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
            <ShieldCheck className="w-4 h-4 mr-2" />
            {isAr ? "مراقبة البوتات والمحتوى" : "Security & Tamper Monitor"}
          </TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
            <FileText className="w-4 h-4 mr-2" />
            {isAr ? "سجلات العمليات" : "Incident & Bot Logs"}
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Connected Users ───────────────────────────────────────── */}
        <TabsContent value="users" className="mt-4">
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base text-gray-900 dark:text-white">
                  {isAr ? "المتداولون المرتبطون بحسابات تيليجرام" : "Users with Linked Telegram Accounts"}
                </CardTitle>
                <CardDescription className="text-xs">
                  {isAr
                    ? "المستخدمون الذين أتموا ربط حساب التيليجرام لاستلام إشعارات التداول ورموز الأمان"
                    : "Traders who linked their Telegram account for trading signals and security alerts"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder={isAr ? "بحث بالاسم، البريد أو المعرف..." : "Search by name, email, chat ID..."}
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchLinkedUsers()}
                  className="w-64 h-9 text-xs bg-gray-50 dark:bg-slate-950 border-gray-200 dark:border-slate-800"
                />
                <Button size="sm" variant="outline" onClick={fetchLinkedUsers}>
                  {isAr ? "تصفية" : "Filter"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="py-8 text-center text-xs text-gray-400">Loading linked accounts...</div>
              ) : users.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">No linked users found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 dark:bg-slate-950/60 text-gray-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">User</th>
                        <th className="py-2.5 px-3">Telegram Chat ID</th>
                        <th className="py-2.5 px-3">Country</th>
                        <th className="py-2.5 px-3">Balance</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                      {users.map((u) => (
                        <tr key={u.uid} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-3">
                            <div className="font-semibold text-gray-900 dark:text-white">
                              {u.full_name || "Anonymous Trader"}
                            </div>
                            <div className="text-gray-400 text-[11px]">{u.email}</div>
                          </td>
                          <td className="py-3 px-3 font-mono">
                            <span className="inline-flex items-center gap-1.5 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded text-blue-400">
                              {u.telegram_chat_id}
                              <button
                                onClick={() => handleCopy(u.telegram_chat_id || "", `chat_${u.uid}`)}
                                className="text-gray-400 hover:text-white"
                              >
                                {copiedKey === `chat_${u.uid}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </span>
                          </td>
                          <td className="py-3 px-3 text-gray-600 dark:text-slate-300">
                            {u.country || "Not set"}
                          </td>
                          <td className="py-3 px-3 font-semibold text-emerald-400">
                            ${Number(u.balance || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              variant="outline"
                              className={
                                u.status === "active"
                                  ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                                  : "border-gray-500/30 text-gray-400"
                              }
                            >
                              {u.status || "active"}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                              onClick={() => openDirectMessage(u.telegram_chat_id || "", u.full_name || "User")}
                            >
                              <Send className="w-3 h-3 mr-1" />
                              DM
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                              onClick={() => handleUnlink(u.uid, u.full_name || "User")}
                            >
                              <Unlink className="w-3 h-3 mr-1" />
                              Unlink
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 2: Security & Profile Monitor ────────────────────────────── */}
        <TabsContent value="monitor" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-gray-900 dark:text-white flex items-center justify-between">
                  <span>@XspyTraderOtp_bot Live Content</span>
                  <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">OTP Bot</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  النصوص المعروضة حالياً على واجهة تيليجرام
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    English Description:
                  </div>
                  <div className="p-2.5 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200 whitespace-pre-wrap">
                    {otp?.descriptions?.default || "No description set"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    Arabic Description (العربية):
                  </div>
                  <div className="p-2.5 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200 whitespace-pre-wrap text-right" dir="rtl">
                    {otp?.descriptions?.ar || "لم يتم تحديد وصف عربي"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    Short Description (Telegram Profile preview):
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200">
                    {otp?.descriptions?.defaultShort || "None"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-gray-900 dark:text-white flex items-center justify-between">
                  <span>@XSpyAIBot Live Content</span>
                  <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">AI Group Bot</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  النصوص المعروضة حالياً على واجهة تيليجرام
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    English Description:
                  </div>
                  <div className="p-2.5 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200 whitespace-pre-wrap">
                    {group?.descriptions?.default || "No description set"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    Arabic Description (العربية):
                  </div>
                  <div className="p-2.5 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200 whitespace-pre-wrap text-right" dir="rtl">
                    {group?.descriptions?.ar || "لم يتم تحديد وصف عربي"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-gray-500 dark:text-slate-400 mb-1">
                    Short Description (Telegram Profile preview):
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-gray-800 dark:text-slate-200">
                    {group?.descriptions?.defaultShort || "None"}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 3: Broadcast Messaging ───────────────────────────────────── */}
        <TabsContent value="broadcast" className="mt-4">
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 max-w-3xl">
            <CardHeader>
              <CardTitle className="text-base text-gray-900 dark:text-white">
                Send Telegram Broadcast or Direct Alert
              </CardTitle>
              <CardDescription className="text-xs">
                إرسال رسائل فورية لجميع المشتركين أو مستخدم محدد مباشرة عبر البوت
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-500 dark:text-slate-400 mb-1 font-semibold">
                    Sending Bot:
                  </label>
                  <select
                    value={msgBotType}
                    onChange={(e) => setMsgBotType(e.target.value as any)}
                    className="w-full h-9 rounded-md bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 px-3 text-xs text-gray-900 dark:text-white"
                  >
                    <option value="otp">@XspyTraderOtp_bot (Security)</option>
                    <option value="group">@XSpyAIBot (AI Support)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gray-500 dark:text-slate-400 mb-1 font-semibold">
                    Target:
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={isBroadcasting ? "default" : "outline"}
                      onClick={() => setIsBroadcasting(true)}
                      className="text-xs flex-1"
                    >
                      All Linked Users ({botsData?.stats.totalLinkedUsers})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!isBroadcasting ? "default" : "outline"}
                      onClick={() => setIsBroadcasting(false)}
                      className="text-xs flex-1"
                    >
                      Single Chat ID
                    </Button>
                  </div>
                </div>
              </div>

              {!isBroadcasting && (
                <div>
                  <label className="block text-gray-500 dark:text-slate-400 mb-1 font-semibold">
                    Target Telegram Chat ID:
                  </label>
                  <Input
                    placeholder="Enter user's Chat ID (e.g. 123456789)"
                    value={msgTargetChatId}
                    onChange={(e) => setMsgTargetChatId(e.target.value)}
                    className="h-9 text-xs bg-gray-50 dark:bg-slate-950 border-gray-200 dark:border-slate-800"
                  />
                </div>
              )}

              <div>
                <label className="block text-gray-500 dark:text-slate-400 mb-1 font-semibold">
                  Quick Templates:
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-[11px] h-7"
                    onClick={() =>
                      setMsgContent(
                        "🚨 *XSPY Trader Security Alert*\n\nPlease remember never to share your OTP codes or account passwords with anyone. Our official support will never ask for them."
                      )
                    }
                  >
                    Security Notice
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-[11px] h-7"
                    onClick={() =>
                      setMsgContent(
                        "📈 *Daily Trading Round Open!*\n\nToday's official trading round is now live. Head over to your dashboard to join before the entry window closes: https://www.xspy-trader.com/dashboard/trading"
                      )
                    }
                  >
                    Trading Alert
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-[11px] h-7"
                    onClick={() =>
                      setMsgContent(
                        "⚡ *Platform Upgrade Completed*\n\nInstant crypto deposits and automated wallet credit are now live on XSPY Trader! Visit: https://www.xspy-trader.com"
                      )
                    }
                  >
                    Feature Announcement
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-gray-500 dark:text-slate-400 mb-1 font-semibold">
                  Message Content (Markdown supported):
                </label>
                <textarea
                  rows={5}
                  value={msgContent}
                  onChange={(e) => setMsgContent(e.target.value)}
                  placeholder="Type your message here... Use *bold*, _italic_, or `code`"
                  className="w-full rounded-md bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-3 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2">
                <Button
                  onClick={handleSendMessageSubmit}
                  disabled={sendingMsg}
                  className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
                >
                  <Send className={`w-4 h-4 mr-2 ${sendingMsg ? "animate-spin" : ""}`} />
                  {sendingMsg ? "Sending Message..." : isBroadcasting ? "Send Broadcast to All Users" : "Send Direct Message"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Connected Telegram Groups & Channels Management ── */}
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 max-w-3xl mt-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base text-gray-900 dark:text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    {isAr ? "مجموعات وقنوات تيليجرام للبث التلقائي" : "Telegram Broadcast Groups & Channels"}
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {isAr
                      ? "إدارة المجموعات والقنوات التي يتصل بها البوت لبث التقارير اليومية وإشارات التداول المباشرة"
                      : "Manage groups and channels where daily summaries and trade signals are automatically broadcast"}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
                  {connectedGroups.length} {isAr ? "مجموعات متصلة" : "Connected"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {/* Connected Groups List */}
              <div className="space-y-2">
                {connectedGroups.length === 0 ? (
                  <div className="p-4 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-800 text-gray-400">
                    {isAr ? "لم يتم ربط أي مجموعة بعد. أضف معرف المجموعة أدناه." : "No groups configured yet. Add a Chat ID below."}
                  </div>
                ) : (
                  connectedGroups.map((g) => (
                    <div
                      key={g.chatId}
                      className="p-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-950/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white text-sm">
                            {g.title}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-mono">
                            {g.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-500 dark:text-slate-400">
                          <span className="font-mono text-[11px] text-blue-400 font-semibold">{g.chatId}</span>
                          <span>•</span>
                          {g.isAdmin ? (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                              👑 {isAr ? "مشرف (Admin)" : "Administrator"}
                            </Badge>
                          ) : g.botStatus === "member" ? (
                            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">
                              ⚠️ {isAr ? "عضو عادي (يحتاج ترقية لمشرف)" : "Member (Promote to Admin)"}
                            </Badge>
                          ) : (
                            <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                              ❌ {g.error || (isAr ? "غير متاح" : "Unavailable")}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestGroupMessage(g.chatId)}
                          disabled={testingGroupChatId === g.chatId}
                          className="h-8 text-[11px] border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                        >
                          <Send className={`w-3.5 h-3.5 mr-1 ${testingGroupChatId === g.chatId ? "animate-spin" : ""}`} />
                          {testingGroupChatId === g.chatId
                            ? isAr
                              ? "جاري الإرسال..."
                              : "Sending..."
                            : isAr
                            ? "إرسال تجربة"
                            : "Test Ping"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveGroupChat(g.chatId)}
                          className="h-8 px-2 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          title={isAr ? "حذف من قائمة البث" : "Remove Group"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add New Group by ID */}
              <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
                <label className="block text-gray-500 dark:text-slate-400 mb-1.5 font-semibold">
                  {isAr ? "إضافة معرف مجموعة أو قناة جديدة (Chat ID):" : "Add New Group or Channel Chat ID:"}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder={isAr ? "مثال: -1001234567890" : "e.g. -1001234567890"}
                    value={newGroupIdInput}
                    onChange={(e) => setNewGroupIdInput(e.target.value)}
                    className="font-mono h-9 text-xs bg-gray-50 dark:bg-slate-950 border-gray-200 dark:border-slate-800 text-gray-900 dark:text-white flex-1"
                  />
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={handleAddGroupChat}
                      disabled={savingGroupId}
                      className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 h-9 text-xs"
                    >
                      <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                      {savingGroupId ? (isAr ? "جاري الإضافة..." : "Adding...") : isAr ? "إضافة مجموعة" : "Add Group"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAutoDetectGroupId}
                      disabled={detectingGroupId}
                      className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0 h-9 text-xs"
                    >
                      {detectingGroupId
                        ? isAr
                          ? "جاري البحث..."
                          : "Detecting..."
                        : isAr
                        ? "🔍 كشف تلقائي"
                        : "🔍 Auto-Detect"}
                    </Button>
                  </div>
                </div>

                {/* Raw IDs Sync (Advanced) */}
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800/60">
                  <details className="text-[11px] text-gray-500 dark:text-slate-400">
                    <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-slate-300 font-semibold">
                      ⚙️ {isAr ? "عرض وتعديل جميع المعرفات مجتمعة (Advanced Raw IDs)" : "Advanced: Edit Raw IDs"}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <Input
                        value={groupChatIdInput}
                        onChange={(e) => setGroupChatIdInput(e.target.value)}
                        placeholder="-1003801262293, -100..."
                        className="font-mono text-xs h-8 bg-gray-50 dark:bg-slate-950 border-gray-200 dark:border-slate-800"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleSaveGroupId}
                        disabled={savingGroupId}
                        className="h-7 text-[11px]"
                      >
                        {isAr ? "💾 حفظ وتحديث المعرفات" : "Save Raw IDs"}
                      </Button>
                    </div>
                  </details>
                </div>

                <div className="mt-3 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-900/40 text-[11px] text-gray-600 dark:text-slate-300 space-y-1">
                  <p className="font-semibold text-blue-500 dark:text-blue-400">
                    💡 {isAr ? "كيفية تفعيل إرسال التقارير والإشارات إلى مجموعاتك وقنواتك:" : "How to connect your groups:"}
                  </p>
                  <p>
                    1. {isAr ? "أضف البوت " : "Add bot "}
                    <code className="text-blue-400 font-bold">@XSpyAIBot</code>
                    {isAr ? " إلى المجموعة أو القناة المرغوبة." : " to your group or channel."}
                  </p>
                  <p>
                    2. {isAr ? "قم بترقية البوت إلى " : "Promote bot to "}
                    <strong>{isAr ? "مشرف (Admin)" : "Administrator"}</strong>
                    {isAr ? " ومنحه صلاحية نشر الرسائل (Post Messages)." : " with permission to post messages."}
                  </p>
                  <p>
                    3. {isAr ? "انسخ معرف المحادثة (Chat ID يبدأ بـ -100) وأضفه أعلاه، ثم اضغط 'إرسال تجربة'." : "Copy Chat ID (-100...) and add it above, then test ping."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Specialized Broadcast Cards: Trade Signals & Daily Summaries ── */}
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 max-w-3xl mt-6">
            <CardHeader>
              <CardTitle className="text-base text-gray-900 dark:text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-purple-400" />
                Live Trade Signals & Daily Group Summary
              </CardTitle>
              <CardDescription className="text-xs">
                بث التقارير اليومية وإشارات التداول المباشرة إلى مجموعة تيليجرام والمستخدمين فوراً
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                      📊 التقرير اليومي وجدول صفقات XSPY Trader
                    </h4>
                    <p className="text-gray-500 dark:text-slate-400 text-[11px] mt-0.5">
                      تقرير احترافي يلخص باقات التعدين، صفقات اليوم، ونظام الإحالة مع رابط التسجيل الرسمي
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSendDailySummary}
                    disabled={sendingDailySummary}
                    className="bg-purple-600 hover:bg-purple-700 text-white shrink-0"
                  >
                    {sendingDailySummary ? "جاري الإرسال..." : "📊 بث التقرير للمجموعة الآن"}
                  </Button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                      ⚡ إشارة تداول تجريبية (Test Signal)
                    </h4>
                    <p className="text-gray-500 dark:text-slate-400 text-[11px] mt-0.5">
                      بث إشعار صفقة تجريبية (EUR/USD, 60s, 3% ROI, BUY) لجميع المستخدمين والمجموعة
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSendTestSignal}
                    disabled={sendingTestSignal}
                    className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 shrink-0"
                  >
                    {sendingTestSignal ? "جاري البث..." : "📢 بث إشارة تجريبية"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: Incident Logs ─────────────────────────────────────────── */}
        <TabsContent value="logs" className="mt-4">
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-gray-900 dark:text-white">
                Bot Activity & Security Incidents
              </CardTitle>
              <CardDescription className="text-xs">
                سجل التنبيهات، هجمات الإعلانات، وعمليات البث التلقائية
              </CardDescription>
            </CardHeader>
            <CardContent>
              {botsData?.recentLogs?.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">
                  No security incidents or alerts logged. Systems healthy.
                </div>
              ) : (
                <div className="space-y-3">
                  {botsData?.recentLogs?.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-950/40 flex items-start gap-3 text-xs"
                    >
                      <div className="p-2 rounded bg-amber-500/10 text-amber-400 shrink-0 mt-0.5">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="font-semibold text-gray-900 dark:text-white truncate">
                            {log.title}
                          </h5>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-gray-600 dark:text-slate-300 mt-0.5">{log.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Direct Message Dialog ─────────────────────────────────────────── */}
      <Dialog open={msgDialogOpen} onOpenChange={setMsgDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base text-gray-900 dark:text-white">
              {isBroadcasting ? "Broadcast to All Linked Users" : `Send Direct Message to ${msgTargetUserName}`}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isBroadcasting
                ? "This will deliver your notification to every user with a linked Telegram account."
                : `Target Chat ID: ${msgTargetChatId}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-xs">
            <div>
              <label className="block text-gray-500 dark:text-slate-400 mb-1">Bot to use:</label>
              <select
                value={msgBotType}
                onChange={(e) => setMsgBotType(e.target.value as any)}
                className="w-full h-8 rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 px-2 text-xs"
              >
                <option value="otp">@XspyTraderOtp_bot</option>
                <option value="group">@XSpyAIBot</option>
              </select>
            </div>

            <div>
              <label className="block text-gray-500 dark:text-slate-400 mb-1">Message:</label>
              <textarea
                rows={4}
                value={msgContent}
                onChange={(e) => setMsgContent(e.target.value)}
                placeholder="Type your message..."
                className="w-full rounded bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-2.5 text-xs text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setMsgDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSendMessageSubmit}
              disabled={sendingMsg}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sendingMsg ? "Sending..." : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
