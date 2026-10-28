$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$destination=Join-Path (Split-Path $PSScriptRoot -Parent) 'desktop\build'
[void][System.IO.Directory]::CreateDirectory($destination)
$base=[System.Drawing.Bitmap]::new(256,256)
$g=[System.Drawing.Graphics]::FromImage($base)
$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)
$shape=[System.Drawing.Drawing2D.GraphicsPath]::new()
foreach($arc in @(@(0,0,64,64,180),@(191,0,64,64,270),@(191,191,64,64,0),@(0,191,64,64,90))){$shape.AddArc($arc[0],$arc[1],$arc[2],$arc[3],$arc[4],90)}
$shape.CloseFigure()
$brush=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#147d85'))
$g.FillPath($brush,$shape)
$font=[System.Drawing.Font]::new('Arial',160,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$format=[System.Drawing.StringFormat]::new()
$format.Alignment=[System.Drawing.StringAlignment]::Center
$format.LineAlignment=[System.Drawing.StringAlignment]::Center
$format.FormatFlags=[System.Drawing.StringFormatFlags]::DirectionRightToLeft
$g.DrawString('د',$font,[System.Drawing.Brushes]::White,[System.Drawing.RectangleF]::new(0,-18,256,256),$format)
$base.Save((Join-Path $destination 'dawa-icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$images=@()
foreach($size in @(16,32,48,64,128,256)){
 $bitmap=[System.Drawing.Bitmap]::new($base,$size,$size)
 $stream=[System.IO.MemoryStream]::new()
 $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
 $images+=@{size=$size;bytes=$stream.ToArray()}
 $stream.Dispose();$bitmap.Dispose()
}
$file=[System.IO.File]::Create((Join-Path $destination 'icon.ico'))
$writer=[System.IO.BinaryWriter]::new($file)
try{
 $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
 $offset=6+16*$images.Count
 foreach($entry in $images){
  $dimension=if($entry.size -eq 256){0}else{$entry.size}
  $writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0)
  $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$entry.bytes.Length);$writer.Write([uint32]$offset)
  $offset+=$entry.bytes.Length
 }
 foreach($entry in $images){$writer.Write([byte[]]$entry.bytes)}
}finally{$writer.Dispose();$g.Dispose();$base.Dispose();$brush.Dispose();$font.Dispose();$format.Dispose();$shape.Dispose()}
Write-Output 'Dawa icon generated in desktop/build.'
