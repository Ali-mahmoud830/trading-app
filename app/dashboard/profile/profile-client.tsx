// app/dashboard/profile/profile-client.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/contexts/language-context";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  InputOTP, InputOTPGroup, InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Mail, CheckCircle, LogOut, User, Shield,
  Activity, Edit, Save, X, Eye, EyeOff,
  ArrowDownCircle, ArrowUpCircle, TrendingUp, AlertCircle,
  MessageCircle, Loader2, ShieldCheck, Info, MapPin, AlertTriangle,
} from "lucide-react";
import { CountrySelect } from "@/components/ui/country-select";

interface ProfileClientProps {
  user: any | null;
  profile?: any | null;
  preferences?: any | null;
}

// ─── Profile OTP Modal ────────────────────────────────────────────────────────
interface ProfileOtpModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sessionId: string;
  expiresAt: string;
  email: string;
  endpoint?: string;
  extraPayload?: Record<string, any>;
}

function ProfileOtpModal({ open, onClose, onSuccess, sessionId, expiresAt, email, endpoint, extraPayload }: ProfileOtpModalProps) {
  const { t } = useLanguage();
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(600);

  useEffect(() => {
    if (!open) return;
    const expiry = new Date(expiresAt).getTime();
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [open, expiresAt]);

  useEffect(() => {
    if (open) {
      setOtp("");
      setSecondsLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }
  }, [open, expiresAt]);

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const expired = secondsLeft === 0;

  const { toast } = useToast();

  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setIsVerifying(true);
    try {
      const res = await fetch(endpoint || "/api/profile/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, otp, ...extraPayload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ 
          title: "Verification Failed", 
          description: data.details || data.error || t("profile.verificationFailed"), 
          variant: "destructive" 
        });
      } else {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      toast({ 
        title: "Network Error", 
        description: err.message || "Something went wrong.", 
        variant: "destructive" 
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isVerifying) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white text-xl">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
            {t("profile.verifyIdentity")}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {t("profile.otpSentToEmail").replace("{email}", email)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Timer */}
          <div className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border ${expired ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-blue-500/10 border-blue-500/30 text-blue-300"}`}>
            <span className="text-sm font-semibold font-mono">
              {expired ? t("profile.codeExpired") : t("profile.codeExpiresIn").replace("{time}", `${mins}:${secs}`)}
            </span>
          </div>

          {/* OTP Input */}
          <div className="space-y-3">
            <Label className="text-slate-200 flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-400" />
              {t("profile.enterVerificationCode")}
            </Label>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={expired}>
                <InputOTPGroup>
                  {[0,1,2,3,4,5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="border-slate-600 bg-slate-800 text-white text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button
            variant="outline"
            className="border-slate-600 text-slate-300 bg-transparent hover:bg-slate-800"
            onClick={onClose}
            disabled={isVerifying}
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold flex-1"
            onClick={handleVerify}
            disabled={otp.length !== 6 || expired || isVerifying}
          >
            {isVerifying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("profile.verifying")}</>
            ) : (
              <><ShieldCheck className="mr-2 h-4 w-4" /> {t("profile.confirmAndSave")}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Profile Component ───────────────────────────────────────────────────
export default function ProfileClient({ user, profile, preferences }: ProfileClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, language, setLanguage } = useLanguage();

  // Temporarily reset language to English if visiting profile in Arabic while Arabic is hidden
  useEffect(() => {
    if (language === "ar") {
      setLanguage("en");
    }
  }, [language, setLanguage]);

  // UI states
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Profile OTP state
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpSession, setOtpSession] = useState<{ sessionId: string; expiresAt: string; type: "profile" | "password" } | null>(null);

  // Activity state
  const [activityDeposits, setActivityDeposits] = useState<any[]>([]);
  const [activityWithdrawals, setActivityWithdrawals] = useState<any[]>([]);
  const [activityTrades, setActivityTrades] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [balance, setBalance] = useState<number>(profile?.balance || 0);

  // Profile form state
  const [profileData, setProfileData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    address: "",
    zipCode: "",
    telegramChatId: "",
  });

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // IP / detected location state
  const [ipLocation, setIpLocation] = useState<{
    country: string | null;
    countryCode: string | null;
    city: string | null;
    loaded: boolean;
  }>({
    country: profile?.ip_country ?? null,
    countryCode: profile?.ip_country_code ?? null,
    city: profile?.ip_city ?? null,
    loaded: !!(profile?.ip_country),
  });

  // Log IP once per session on mount
  useEffect(() => {
    if (!user) return;
    const key = `_ip_logged_${user.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    fetch("/api/geo/log-ip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.country) {
          setIpLocation({ country: d.country, countryCode: null, city: null, loaded: true });
        }
      })
      .catch(() => {
        // Non-critical — silently ignore
      });
  }, [user]);

  // Populate state from props
  useEffect(() => {
    const loadIfMissing = async () => {
      if (!user) return;

      let profileRow = profile ?? null;
      if (!profileRow) {
        const { data } = await supabase.from("user_profiles").select("*").eq("uid", user.id).single();
        if (data) profileRow = data;
      }

      setProfileData({
        firstName: profileRow?.first_name ?? (user?.user_metadata?.full_name ? String(user.user_metadata.full_name).split(" ")[0] : ""),
        lastName: profileRow?.last_name ?? (user?.user_metadata?.full_name ? String(user.user_metadata.full_name).split(" ")[1] : ""),
        email: user?.email ?? "",
        phone: profileRow?.phone ?? "",
        country: profileRow?.country ?? "",
        city: profileRow?.city ?? "",
        address: profileRow?.address ?? "",
        zipCode: profileRow?.zip_code ?? "",
        telegramChatId: profileRow?.telegram_chat_id ?? "",
      });
    };
    loadIfMissing();
  }, [user]);

  // Fetch activity
  const fetchActivity = useCallback(async () => {
    if (!user) return;
    setActivityLoading(true);
    try {
      const [depRes, wdRes, tradeRes, profRes] = await Promise.all([
        supabase.from("deposits").select("id, amount, status, created_at").eq("uid", user.id).order("created_at", { ascending: false }).limit(8),
        supabase.from("withdrawals").select("id, amount, status, created_at, net_amount").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
        supabase.from("trades").select("id, asset, type, amount, result, profit_loss, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
        supabase.from("user_profiles").select("balance, kyc_status").eq("uid", user.id).single(),
      ]);
      if (depRes.data) setActivityDeposits(depRes.data);
      if (wdRes.data) setActivityWithdrawals(wdRes.data);
      if (tradeRes.data) setActivityTrades(tradeRes.data);
      if (profRes.data) {
        setBalance(Number(profRes.data.balance) || 0);
      }
    } finally {
      setActivityLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => fetchActivity(), 5000);
    return () => clearInterval(interval);
  }, [user, fetchActivity]);

  // ─── Save Changes → Trigger OTP flow ────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;
    if (!profileData.firstName?.trim() || !profileData.lastName?.trim()) {
      toast({ title: t("profile.missingField") || "Missing field", description: t("profile.firstLastRequired") || "First and last name are required.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: profileData.firstName,
          lastName: profileData.lastName,
          phone: profileData.phone,
          country: profileData.country,
          city: profileData.city,
          address: profileData.address,
          zipCode: profileData.zipCode,
          telegramChatId: profileData.telegramChatId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("profile.saveFailed") || "Save failed", description: data.error || "Could not send verification code.", variant: "destructive" });
        return;
      }

      setOtpSession({ sessionId: data.sessionId, expiresAt: data.expiresAt, type: "profile" });
      setShowOtpModal(true);
      toast({ title: t("profile.verificationCodeSent") || "Verification code sent!", description: t("profile.checkYourEmail") || "Check your email for the 6-digit code." });

    } catch (err: any) {
      toast({ title: t("profile.saveFailed") || "Save failed", description: err?.message || "Network error.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // ─── OTP Verified → Profile saved ───────────────────────────────────────
  const handleOtpSuccess = () => {
    toast({ title: t("profile.profileUpdated") || "Profile Updated", description: t("profile.profileUpdatedDesc") || "Your profile information has been saved successfully." });
    setIsEditing(false);
    setOtpSession(null);
    router.refresh();
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: t("profile.missingField") || "Missing field", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    
    setIsPasswordSaving(true);
    try {
      const res = await fetch("/api/profile/send-password-otp", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("profile.saveFailed") || "Failed", description: data.error || "Could not send verification code.", variant: "destructive" });
        return;
      }
      setOtpSession({ sessionId: data.sessionId, expiresAt: data.expiresAt, type: "password" });
      setShowOtpModal(true);
      toast({ title: t("profile.verificationCodeSent") || "Code sent!", description: t("profile.checkYourEmail") || "Check your email." });
    } catch (err: any) {
      toast({ title: t("profile.saveFailed") || "Failed", description: err?.message || "Network error.", variant: "destructive" });
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const handlePasswordOtpSuccess = () => {
    toast({ title: t("profile.passwordUpdated") || "Password updated", description: t("profile.passwordUpdatedDesc") || "Your password has been changed successfully." });
    setCurrentPassword("");
    setNewPassword("");
    setOtpSession(null);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      router.replace("/auth/login");
    } catch (err: any) {
      toast({ title: t("profile.logoutFailed") || "Logout failed", description: err?.message || "Could not sign out.", variant: "destructive" });
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-6">
        <p className="text-white">{t("auth.login")}</p>
      </div>
    );
  }

  const isProfileComplete = !!(
    profileData.firstName?.trim() &&
    profileData.lastName?.trim() &&
    profileData.phone?.trim() &&
    profileData.country?.trim()
  );

  const isAdmin = profile?.role === "admin" || (typeof window !== "undefined" && !!localStorage.getItem("_admin_impersonating"));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-6 pb-24" data-react-protected>
      <div className="max-w-6xl mx-auto space-y-6" translate="no" data-react-protected>

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between space-y-4 md:space-y-0" translate="no">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <span className="text-white text-xl font-bold">
                {(profileData.firstName?.charAt(0) || "") + (profileData.lastName?.charAt(0) || "")}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{profileData.firstName} {profileData.lastName}</h1>
              <p className="text-blue-200 flex items-center"><Mail className="w-4 h-4 mr-2" />{profileData.email}</p>
              <div className="flex items-center space-x-2 mt-2">
                <Badge variant="outline" className={[
                  isProfileComplete
                    ? "text-green-400 border-green-400 bg-green-400/10"
                    : "text-yellow-400 border-yellow-400 bg-yellow-400/10"
                ].join(" ")}>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {isProfileComplete ? t("profile.verifiedAccount") : t("profile.waitingVerification")}
                </Badge>
                <Badge variant="outline" className="text-blue-400 border-blue-400 bg-blue-400/10">
                  {t("profile.balance")}: ${balance.toFixed(2)}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-3">
            {isAdmin && (
              <Button
                onClick={() => router.push("/admin/dashboard")}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-purple-600/20"
              >
                <Shield className="w-4 h-4 mr-2" />
                {t("admin.returnToAdmin") || "Return to Admin Panel"}
              </Button>
            )}
            <LanguageSwitcher hideArabic={true} />
            <Button
              variant="outline"
              className="border-red-600 text-red-400 hover:bg-red-600/10 bg-transparent"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              <LogOut className="w-4 h-4 mr-2" />
              {isLoggingOut ? t("common.loading") : t("auth.logout")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6" translate="no">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {isAdmin && (
              <Card className="trading-card border-purple-500/40 bg-purple-950/20">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-purple-300 font-semibold text-sm">
                    <Shield className="w-4 h-4 text-purple-400" />
                    {t("admin.adminPanel") || "Administrator Access"}
                  </div>
                  <p className="text-xs text-purple-300/80">
                    {t("admin.returnToAdminDesc") || "You have administrative access to the platform."}
                  </p>
                  <Button
                    onClick={() => router.push("/admin/dashboard")}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs h-9 font-medium"
                  >
                    <Shield className="w-3.5 h-3.5 mr-1.5" />
                    {t("admin.returnToAdmin") || "Return to Admin Panel"}
                  </Button>
                </CardContent>
              </Card>
            )}
            <Card className="trading-card" translate="no" data-react-protected>
              <CardHeader>
                <CardTitle className="text-white text-lg">{t("profile.accountOverview")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("profile.balance")}</span>
                  <span className="text-white font-bold">${balance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("common.status")}</span>
                  <Badge className="bg-green-600 text-white">
                    {profile?.status === "active"
                      ? (t("profile.statusActive") || t("common.status_active") || "Active")
                      : profile?.status === "verified"
                        ? (t("profile.statusVerified") || "Verified")
                        : profile?.status === "pending"
                          ? (t("profile.statusPending") || t("common.pending") || "Pending")
                          : profile?.status === "banned"
                            ? (t("profile.statusBanned") || "Suspended")
                            : (profile?.status || t("profile.statusActive") || "Active")}
                  </Badge>
                </div>

                {/* Telegram Link Status */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("profile.telegram")}</span>
                  <Badge variant="outline" className={profileData.telegramChatId ? "text-green-400 border-green-400" : "text-amber-400 border-amber-400"}>
                    {profileData.telegramChatId ? t("profile.telegramLinked") : t("profile.notLinked")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <Tabs defaultValue="profile" className="space-y-6">
              <TabsList className="flex justify-between w-full bg-gradient-to-r from-slate-800/60 to-slate-900/60 backdrop-blur-sm border border-slate-700/50 p-2 rounded-xl shadow-inner" translate="no">
                <TabsTrigger value="profile" className="flex-1 flex items-center justify-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-lg">
                  <User className="w-4 h-4" /> {t("profile.profile")}
                </TabsTrigger>
                <TabsTrigger value="security" className="flex-1 flex items-center justify-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-lg">
                  <Shield className="w-4 h-4" /> {t("profile.security")}
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1 flex items-center justify-center gap-1.5 text-xs sm:text-sm data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-lg">
                  <Activity className="w-4 h-4" /> {t("profile.activity")}
                </TabsTrigger>
              </TabsList>

              {/* Profile Tab */}
              <TabsContent value="profile" translate="no">
                <Card className="trading-card" translate="no" data-react-protected>
                  <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <CardTitle className="text-white flex items-center shrink-0"><User className="w-5 h-5 mr-2" />{t("profile.personalInformation")}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)} className="border-slate-600 text-slate-300 bg-transparent">
                        {isEditing ? <><X className="w-4 h-4 mr-2" />{t("common.cancel")}</> : <><Edit className="w-4 h-4 mr-2" />{t("profile.editProfile")}</>}
                      </Button>
                      {isEditing && (
                        <Button onClick={handleSave} size="sm" disabled={isSaving} className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                          {isSaving ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t("common.sending")}</>
                          ) : (
                            <><Save className="w-4 h-4 mr-2" />{t("profile.saveChanges")}</>
                          )}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Name Fields */}
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-slate-300">{t("auth.firstName")}</Label>
                        <Input
                          id="firstName"
                          value={profileData.firstName}
                          onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
                          disabled={!isEditing}
                          className="bg-slate-800/50 border-slate-600 text-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-slate-300">{t("auth.lastName")}</Label>
                        <Input
                          id="lastName"
                          value={profileData.lastName}
                          onChange={(e) => setProfileData({ ...profileData, lastName: e.target.value })}
                          disabled={!isEditing}
                          className="bg-slate-800/50 border-slate-600 text-white"
                        />
                      </div>

                      {/* Phone */}
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-slate-300">{t("auth.phone")}</Label>
                        <Input
                          id="phone"
                          value={profileData.phone}
                          onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                          disabled={!isEditing}
                          placeholder="+1 555 000 0000"
                          className="bg-slate-800/50 border-slate-600 text-white"
                        />
                      </div>

                      {/* Country — searchable dropdown */}
                      <div className="space-y-2">
                        <Label className="text-slate-300 flex items-center gap-1.5">
                          {t("auth.country")}
                          {/* IP badge */}
                          {ipLocation.loaded && ipLocation.country && (
                            <Badge
                              variant="outline"
                              className="text-xs font-normal border-blue-500/50 text-blue-400 bg-blue-500/10 ml-1"
                              title="Detected from your IP address"
                            >
                              <MapPin className="w-2.5 h-2.5 mr-1" />
                              {t("profile.detectedIp") ? t("profile.detectedIp").replace("{country}", ipLocation.country) : `IP: ${ipLocation.country}`}
                            </Badge>
                          )}
                        </Label>
                        <CountrySelect
                          value={profileData.country}
                          onChange={(country) => setProfileData({ ...profileData, country })}
                          disabled={!isEditing}
                          placeholder={t("auth.country") || "Select your country..."}
                        />
                      </div>

                      {/* City */}
                      <div className="space-y-2">
                        <Label htmlFor="city" className="text-slate-300">{t("profile.city")}</Label>
                        <Input
                          id="city"
                          value={profileData.city}
                          onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
                          disabled={!isEditing}
                          className="bg-slate-800/50 border-slate-600 text-white"
                        />
                      </div>

                      {/* Email (read-only) */}
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-slate-300">{t("auth.email")}</Label>
                        <Input id="email" type="email" value={profileData.email} disabled className="bg-slate-800/50 border-slate-600 text-white opacity-60" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="address" className="text-slate-300">{t("common.address")}</Label>
                        <Input id="address" value={profileData.address} onChange={(e) => setProfileData({ ...profileData, address: e.target.value })} disabled={!isEditing} className="bg-slate-800/50 border-slate-600 text-white" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zipCode" className="text-slate-300">{t("profile.zipCode")}</Label>
                        <Input id="zipCode" value={profileData.zipCode} onChange={(e) => setProfileData({ ...profileData, zipCode: e.target.value })} disabled={!isEditing} className="bg-slate-800/50 border-slate-600 text-white" />
                      </div>
                    </div>

                    {/* Telegram Chat ID section */}
                    <div className="space-y-3 pt-2 border-t border-slate-700">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-sky-400" />
                        <h3 className="text-white font-medium">{t("profile.telegramLinking")}</h3>
                        {profileData.telegramChatId && (
                          <Badge variant="outline" className="text-green-400 border-green-400 text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" /> {t("profile.telegramLinked")}
                          </Badge>
                        )}
                      </div>

                      <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-start gap-3">
                        <Info className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                        <p className="text-sky-200 text-xs leading-relaxed">
                          {t("profile.telegramChatIdHint")}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="telegramChatId" className="text-slate-300">
                          {t("profile.telegramChatId")}
                        </Label>
                        <Input
                          id="telegramChatId"
                          placeholder={t("profile.telegramChatIdPlaceholder")}
                          value={profileData.telegramChatId}
                          onChange={(e) => setProfileData({ ...profileData, telegramChatId: e.target.value.replace(/\D/g, "") })}
                          disabled={!isEditing}
                          className="bg-slate-800/50 border-slate-600 text-white"
                        />
                      </div>
                    </div>

                    {/* ── Integrity Warning (shown when editing) ──────────────── */}
                    {isEditing && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-amber-200 text-xs leading-relaxed">
                          <strong className="text-amber-300">{t("profile.accuracyNoticeTitle") || "Accuracy Notice:"}</strong>{" "}
                          {t("profile.accuracyNoticeDesc") || "Please ensure all information you provide is accurate and truthful. Submitting false details — including your country, phone number, or name — may result in your account being suspended or frozen until identity verification is completed by contacting our support team."}
                        </p>
                      </div>
                    )}

                    {/* OTP Security Notice */}
                    {isEditing && (
                      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-start gap-3">
                        <ShieldCheck className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                        <p className="text-blue-200 text-xs">
                          {t("profile.saveOtpNotice")}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Security Tab */}
              <TabsContent value="security" translate="no">
                <Card className="trading-card" translate="no" data-react-protected>
                  <CardHeader>
                    <CardTitle className="text-white flex items-center"><Shield className="w-5 h-5 mr-2" />{t("profile.security")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-white font-medium">{t("profile.changePassword")}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="currentPassword" className="text-slate-300">{t("profile.currentPassword")}</Label>
                          <div className="relative">
                            <Input id="currentPassword" type={showPassword ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="bg-slate-800/50 border-slate-600 text-white pr-10" />
                            <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 py-2" onClick={() => setShowPassword(!showPassword)}>
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newPassword" className="text-slate-300">{t("profile.newPassword")}</Label>
                          <div className="relative">
                            <Input id="newPassword" type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-slate-800/50 border-slate-600 text-white pr-10" />
                            <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 py-2" onClick={() => setShowNewPassword(!showNewPassword)}>
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button className="bg-gradient-to-r from-blue-600 to-purple-600 text-white" onClick={handleChangePassword} disabled={isPasswordSaving}>
                          {isPasswordSaving ? t("common.updating") : t("profile.updatePassword")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Activity Tab */}
              <TabsContent value="activity" translate="no">
                <Card className="trading-card" translate="no" data-react-protected>
                  <CardHeader>
                    <CardTitle className="text-white flex items-center"><Activity className="w-5 h-5 mr-2" />{t("profile.activity")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {activityLoading ? (
                      <p className="text-muted-foreground text-sm text-center py-6">{t("common.loading")}</p>
                    ) : (
                      <>
                        {activityDeposits.map((d) => (
                          <div key={`dep-${d.id}`} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-700 hover:bg-slate-800/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-green-600/20 rounded-full flex items-center justify-center shrink-0">
                                <ArrowDownCircle className="w-4 h-4 text-green-400" />
                              </div>
                              <div>
                                <p className="text-white text-sm font-medium">{t("wallet.deposit")}</p>
                                <p className="text-slate-400 text-xs">{new Date(d.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-green-400 font-semibold">+${Number(d.amount).toFixed(2)}</p>
                              <Badge className={`text-xs ${d.status === "approved" || d.status === "confirmed" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>{d.status}</Badge>
                            </div>
                          </div>
                        ))}

                        {activityWithdrawals.map((w) => (
                          <div key={`wd-${w.id}`} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-700 hover:bg-slate-800/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-red-600/20 rounded-full flex items-center justify-center shrink-0">
                                <ArrowUpCircle className="w-4 h-4 text-red-400" />
                              </div>
                              <div>
                                <p className="text-white text-sm font-medium">{t("wallet.withdraw")}</p>
                                <p className="text-slate-400 text-xs">{new Date(w.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-red-400 font-semibold">-${Number(w.amount).toFixed(2)}</p>
                              <Badge className={`text-xs ${w.status === "paid" || w.status === "approved" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>{w.status}</Badge>
                            </div>
                          </div>
                        ))}

                        {activityTrades.map((tr) => (
                          <div key={`tr-${tr.id}`} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-700 hover:bg-slate-800/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-blue-600/20 rounded-full flex items-center justify-center shrink-0">
                                <TrendingUp className="w-4 h-4 text-blue-400" />
                              </div>
                              <div>
                                <p className="text-white text-sm font-medium">{tr.asset} · {tr.type}</p>
                                <p className="text-slate-400 text-xs">{new Date(tr.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-white text-sm">${tr.amount}</p>
                              <Badge className={`text-xs ${tr.result === "win" ? "bg-green-500/20 text-green-400" : tr.result === "lose" ? "bg-red-500/20 text-red-400" : "bg-slate-500/20 text-slate-400"}`}>
                                {tr.result === "pending" || !tr.result ? t("common.pending") : tr.result}
                              </Badge>
                            </div>
                          </div>
                        ))}

                        {activityDeposits.length === 0 && activityWithdrawals.length === 0 && activityTrades.length === 0 && (
                          <div className="text-center py-10 text-muted-foreground">
                            <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p>{t("profile.noActivityYet")}</p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Profile OTP Verification Modal */}
        {otpSession && (
          <ProfileOtpModal
            open={showOtpModal}
            onClose={() => { setShowOtpModal(false); setOtpSession(null); }}
            onSuccess={otpSession.type === "password" ? handlePasswordOtpSuccess : handleOtpSuccess}
            sessionId={otpSession.sessionId}
            expiresAt={otpSession.expiresAt}
            email={profileData.email}
            endpoint={otpSession.type === "password" ? "/api/profile/verify-password-otp" : "/api/profile/verify-otp"}
            extraPayload={otpSession.type === "password" ? { newPassword } : undefined}
          />
        )}
      </div>
    </div>
  );
}
