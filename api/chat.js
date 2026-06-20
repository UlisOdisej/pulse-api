.then(function(data) {
  load.remove();
  pageLastOffset = data.offset || 0;

  var ans = document.createElement('div');
  ans.style.cssText = 'font-size:15px;line-height:1.8;margin-bottom:12px;';

  // RESET SAFE RENDER
  var output = "";

  if (Array.isArray(data.answer)) {
    output = data.answer.map(function(item) {
      return (item.category || "") + " | " + (item.author || "") + " - " + (item.title || "");
    }).join("<br>");
  } else if (typeof data.answer === "string") {
    output = data.answer;
  } else {
    output = JSON.stringify(data.answer);
  }

  ans.innerHTML = output;
  div.appendChild(ans);

  // SOURCES (ako postoje)
  if (data.sources && data.sources.length > 0) {
    var src = document.createElement('div');
    src.style.cssText = 'font-size:13px;color:#666;margin-bottom:12px;border-top:1px solid #ddd;padding-top:10px;margin-top:10px;';
    src.innerHTML = '<strong>Izvor:</strong> ' + data.sources.map(function(s) {
      return '<a href="' + s.permalink + '" target="_blank" style="color:#0066cc;text-decoration:none;margin-right:8px;">' + s.title + '</a>';
    }).join(', ');
    div.appendChild(src);
  }

  // HISTORY
  if (!more) {
    pageHistory.push({ role: 'user', content: q });
    pageHistory.push({ role: 'assistant', content: JSON.stringify(data.answer) });
  }
})
