import React from 'react';
import { Icon } from './Icon.tsx';

export const FeatureList: React.FC = () => {
    return (
        <section className="mt-12 w-full max-w-4xl mx-auto text-right font-vazir" dir="rtl">
            <h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400 mb-8">
                قابلیت‌های کلیدی و پیشرفته
            </h2>
            <div className="grid gap-6 md:grid-cols-2 text-gray-200">
                 <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-teal-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-teal-400">
                        <Icon name="audio-wave" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">همگام‌سازی فوق‌دقیق (۰.۰۱ ثانیه)</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        این سیستم از هوش مصنوعی برای استخراج زمان‌بندی کلمات با دقت صدم ثانیه استفاده می‌کند. نمایشگر متن بصورت زنده و بدون تاخیر (Real-time) با صدای در حال پخش هماهنگ می‌شود که برای تمرین آواز یا روخوانی دقیق ایده‌آل است.
                    </p>
                </div>

                <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-purple-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-purple-400">
                        <Icon name="language" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">ترجمه چندزبانه و فینگلیش</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        علاوه بر متن اصلی، می‌توانید ترجمه فارسی (رسمی و ادبی)، انگلیسی روان، و یا <strong>فینگلیش</strong> (متن فارسی با حروف انگلیسی) را دریافت کنید. این قابلیت برای یادگیری زبان یا استفاده در کلیساهای چندملیتی بسیار کاربردی است.
                    </p>
                </div>

                 <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-orange-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-orange-400">
                        <Icon name="presentation" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">خروجی پاورپوینت هوشمند (PPSX)</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        تولید خودکار اسلایدشو با تصاویر پس‌زمینه مرتبط (تولید شده توسط هوش مصنوعی Imagen). پشتیبانی کامل از چینش راست‌چین (RTL) و فونت وزیرمتن برای فارسی. فایل صوتی شما نیز درون فایل پاورپوینت تعبیه می‌شود تا ارائه بدون نیاز به فایل‌های جانبی اجرا شود.
                    </p>
                </div>

                <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-blue-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-blue-400">
                        <Icon name="music" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">حالت تخصصی پرستشی و آکورد</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        در حالت "سرود پرستشی" (Worship Song)، هوش مصنوعی ساختار شعر را تشخیص داده و متن را بصورت بندهای منظم (Stanza) مرتب می‌کند. همچنین قابلیت تشخیص آکوردهای موسیقی از روی فایل صوتی و نمایش آن‌ها برای نوازندگان فراهم شده است.
                    </p>
                </div>

                <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-red-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-red-400">
                        <Icon name="touch" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">ویرایش متن و هماهنگی دستی</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        اگر هوش مصنوعی خطایی داشت، نگران نباشید! با قابلیت «ویرایش متن» می‌توانید کلمات را اصلاح کنید. همچنین با حالت «هماهنگی لمسی»، می‌توانید هنگام پخش موزیک روی کلمات کلیک کنید تا زمان‌بندی آن‌ها دقیقا با لحظه کلیک شما تنظیم شود.
                    </p>
                </div>

                <div className="p-6 rounded-xl bg-gray-800/60 border border-gray-700 hover:border-green-500/50 transition-all shadow-lg">
                    <div className="flex items-center gap-3 mb-3 text-green-400">
                        <Icon name="microphone" className="w-6 h-6" />
                        <h3 className="font-bold text-lg">تولید صوتی (TTS) با لهجه طبیعی</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-400">
                        متن‌های ترجمه شده را با صدای طبیعی و انسانی بشنوید. برای متون فارسی از مدل‌های پیشرفته جهت خوانش با لهجه استاندارد ایرانی و برای انگلیسی از صداهای نیتیو استفاده می‌شود.
                    </p>
                </div>
            </div>
        </section>
    );
};