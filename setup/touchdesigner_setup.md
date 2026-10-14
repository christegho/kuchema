The cleanest setup is to **have Kuchema running as the image generator and use TouchDesigner for display, animation and interaction**. The app already has the API needed.


1. **Start Kuchema**

   Run `npm run dev` in this repository. On the same computer, TouchDesigner can connect to `http://127.0.0.1:3000`.

2. **Trigger a collage from TouchDesigner**

   Create a **Web Client DAT** named `kuchema_api`. It supports HTTP requests and response callbacks. [Derivative documentation](https://derivative.ca/UserGuide/WebclientDAT_Class)

   Run this from a Text DAT or button callback:

   ```python
   import json
   import uuid

   op('kuchema_api').request(
       'http://127.0.0.1:3000/api/creations',
       'POST',
       header={'Content-Type': 'application/json'},
       data=json.dumps({
           'prompt': 'Water connects land, plants and collective life.',
           'count': 6,
           'includePeople': True,
           'requestId': str(uuid.uuid4())
       })
   )
   ```

   This uses the official archive and its random selection rules. The response contains the job’s `id`.

3. **Poll for completion**

   Use another Web Client DAT to request the following every two seconds:

   ```text
   GET http://127.0.0.1:3000/api/creations/<job-id>
   ```

   Read these response fields:

   | Field | Use in TouchDesigner |
   |---|---|
   | `stage`, `progress` | Display generation progress |
   | `status` | Detect completion, cancellation or failure |
   | `outputUrl` | Load the completed image when available |
   | `warnings` | Identify incomplete cuts or composition issues |

4. **Load the result**

   Create a **Movie File In TOP** named `collage`. Once the response has `status: "complete"` and an `outputUrl`, set:

   ```python
   op('collage').par.file = (
       'http://127.0.0.1:3000' + job['outputUrl']
   )
   ```

   Here, `job` is the parsed JSON response. Movie File In TOP supports images loaded through HTTP. [Derivative documentation](https://docs.derivative.ca/Movie_File_In_TOP)

Keep the previous collage visible while another is being generated; the server accepts one generation at a time.