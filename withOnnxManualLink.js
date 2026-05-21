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
    
    config.modResults.contents = contents;
    return config;
  });

  // Automatically copy the ONNX model to Android assets folder
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidAssetsDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets');
      const sourceModelPath = path.join(projectRoot, 'assets', 'models', 'w600k_mbf.onnx');
      const destModelPath = path.join(androidAssetsDir, 'w600k_mbf.onnx');

      if (!fs.existsSync(androidAssetsDir)) {
        fs.mkdirSync(androidAssetsDir, { recursive: true });
      }

      if (fs.existsSync(sourceModelPath)) {
        fs.copyFileSync(sourceModelPath, destModelPath);
      } else {
        console.warn('WARNING: ONNX model not found at ' + sourceModelPath);
      }
      
      return config;
    },
  ]);

  return config;
};
