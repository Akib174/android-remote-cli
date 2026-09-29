#!/bin/bash
echo "Installing prerequisites..."
sudo apt-get update && sudo apt-get install -y wget unzip libsdk-ext-dev

# Android SDK ডিরেক্টরি তৈরি
mkdir -p $HOME/android-sdk/cmdline-tools

# লেটেস্ট কমান্ড লাইন টুলস ডাউনলোড (2026 আপডেট অনুযায়ী)
cd $HOME/android-sdk/cmdline-tools
wget https://google.com
unzip commandlinetools-linux-*_latest.zip
mv cmdline-tools latest

# পরিবেশের পাথ (Environment Paths) সেটআপ
echo 'export ANDROID_HOME=$HOME/android-sdk' >> $HOME/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools' >> $HOME/.bashrc
source $HOME/.bashrc

# লাইসেন্স এক্সেপ্ট করা
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
yes | sdkmanager --licenses

# প্রয়োজনীয় SDK Platform এবং Build Tools ইনস্টল
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
echo "Android SDK CLI Setup Complete!"
