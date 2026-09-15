package com.example;

import com.qxci.atom.QxciAtomSdk;

/** 示例入口：javac 后随包分发 class。 */
public class HelloAtom {
    public static void main(String[] args) {
        String input = QxciAtomSdk.getInputJson();
        QxciAtomSdk.logInfo("workspace=" + QxciAtomSdk.getWorkspace());
        QxciAtomSdk.logInfo("input=" + input);
        QxciAtomSdk.setOutput(QxciAtomSdk.SUCCESS, "ok", QxciAtomSdk.mapOf("echo", input));
    }
}
