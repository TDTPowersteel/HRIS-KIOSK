const { withSettingsGradle, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withManualOnnxLinking(config) {
  // Add to settings.gradle
  config = withSettingsGradle(config, (config) => {
    const includeStr = `include ':onnxruntime-react-native'\nproject(':onnxruntime-react-native').projectDir = new File(rootProject.projectDir, '../node_modules/onnxruntime-react-native/android')`;
    if (!config.modResults.contents.includes("include ':onnxruntime-react-native'")) {
      config.modResults.contents += '\n' + includeStr + '\n';
    }
    return config;
  });

  // Add to MainApplication.kt
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    
    if (!contents.includes('import ai.onnxruntime.reactnative.OnnxruntimePackage')) {
      contents = contents.replace(
        'import com.facebook.react.PackageList',
        'import com.facebook.react.PackageList\nimport ai.onnxruntime.reactnative.OnnxruntimePackage'
      );
    }

    if (!contents.includes('add(OnnxruntimePackage())')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(OnnxruntimePackage())'
      );
    }
    
    // Register custom NativeFacePreprocessorPackage
    if (!contents.includes('add(NativeFacePreprocessorPackage())')) {
      if (contents.includes('add(OnnxruntimePackage())')) {
        contents = contents.replace(
          'add(OnnxruntimePackage())',
          'add(OnnxruntimePackage())\n              add(NativeFacePreprocessorPackage())'
        );
      } else {
        // Fallback package injection
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          'PackageList(this).packages.apply {\n              add(NativeFacePreprocessorPackage())'
        );
      }
    }
    
    config.modResults.contents = contents;
    return config;
  });

  // Automatically copy files (ONNX model + Custom Kotlin Modules)
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      
      // 1. Copy ONNX Model
      const androidAssetsDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets');
      const sourceModelPath = path.join(projectRoot, 'assets', 'models', 'w600k_mbf.onnx');
      const destModelPath = path.join(androidAssetsDir, 'w600k_mbf.onnx');

      if (!fs.existsSync(androidAssetsDir)) {
        fs.mkdirSync(androidAssetsDir, { recursive: true });
      }

      if (fs.existsSync(sourceModelPath)) {
        fs.copyFileSync(sourceModelPath, destModelPath);
        console.log('[withManualOnnxLinking] Successfully copied ONNX model to assets.');
      } else {
        console.warn('WARNING: ONNX model not found at ' + sourceModelPath);
      }

      // 2. Copy Custom Native Kotlin Modules
      const srcNativeAndroidDir = path.join(projectRoot, 'src', 'native', 'android');
      const destNativeAndroidDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'ams', 'attendanceapp');

      if (fs.existsSync(srcNativeAndroidDir)) {
        if (!fs.existsSync(destNativeAndroidDir)) {
          fs.mkdirSync(destNativeAndroidDir, { recursive: true });
        }
        
        const filesToCopy = [
          'NativeFacePreprocessorModule.kt',
          'NativeFacePreprocessorPackage.kt'
        ];

        filesToCopy.forEach((filename) => {
          const srcFilePath = path.join(srcNativeAndroidDir, filename);
          const destFilePath = path.join(destNativeAndroidDir, filename);
          
          if (fs.existsSync(srcFilePath)) {
            fs.copyFileSync(srcFilePath, destFilePath);
            console.log(`[withManualOnnxLinking] Successfully copied ${filename} to native android project.`);
          } else {
            console.warn(`WARNING: Custom native file not found at ${srcFilePath}`);
          }
        });
      }
      
      return config;
    },
  ]);

  return config;
};
